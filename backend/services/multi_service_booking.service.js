const db = require('../config/db');
const redis = require('../config/redis');
const { getIO } = require('../config/socket');
const optimizer = require('./multi_service_optimizer.service');

class MultiServiceBookingService {
    /**
     * Creates a new multi-service booking draft and returns candidate AI plans
     */
    async createBooking(userId, services, location, scheduledAt = null) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const { lat, lng, address, notes } = location;

            // 1. Insert parent booking record
            const bookingRes = await client.query(`
                INSERT INTO multi_service_bookings (user_id, location_lat, location_lng, address, notes, scheduled_at, status)
                VALUES ($1, $2, $3, $4, $5, COALESCE($6, NOW()), 'PENDING_PLAN')
                RETURNING *
            `, [userId, lat, lng, address, notes, scheduledAt]);

            const booking = bookingRes.rows[0];

            // 2. Insert booking items
            const items = [];
            let totalBasePrice = 0;
            for (const item of services) {
                const categoryClean = item.category.trim().toUpperCase();
                const itemRes = await client.query(`
                    INSERT INTO multi_service_booking_items (booking_id, service_category, description, base_price, status)
                    VALUES ($1, $2, $3, $4, 'PENDING')
                    RETURNING *
                `, [booking.id, categoryClean, item.description || '', item.price || 250.00]);
                
                items.push(itemRes.rows[0]);
                totalBasePrice += parseFloat(item.price || 250.00);
            }

            await client.query('COMMIT');

            // 3. Compute optimal AI plans
            const categories = services.map(s => s.category);
            const optResult = await optimizer.findOptimalPlans(categories, lat, lng, userId);
            const { plans, frequentlyAddedTogether, aiUpsell } = optResult;

            // Cache plans in Redis for plan selection (TTL: 1 hour)
            const cacheKey = `multi_booking:plans:${booking.id}`;
            await redis.set(cacheKey, JSON.stringify(plans), 'EX', 3600);

            // Return booking metadata + candidate plans
            return {
                bookingId: booking.id,
                basePrice: totalBasePrice,
                scheduledAt: booking.scheduled_at,
                plans,
                frequentlyAddedTogether,
                aiUpsell
            };
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    /**
     * Customer selects and accepts a specific AI execution plan
     */
    async acceptPlan(bookingId, planIndex, userId) {
        const cacheKey = `multi_booking:plans:${bookingId}`;
        const cachedPlans = await redis.get(cacheKey);
        if (!cachedPlans) {
            throw new Error("Plan suggestions expired or invalid. Please re-create the booking request.");
        }

        const plans = JSON.parse(cachedPlans);
        const selectedPlan = plans[planIndex];
        if (!selectedPlan) {
            throw new Error("Invalid plan index chosen.");
        }

        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            // Update parent booking with plan choice
            await client.query(`
                UPDATE multi_service_bookings
                SET status = 'PLAN_READY',
                    plan_type = $1,
                    selected_plan_index = $2,
                    total_price = $3,
                    estimated_duration_minutes = $4,
                    updated_at = NOW()
                WHERE id = $5 AND user_id = $6
            `, [
                selectedPlan.planType,
                planIndex,
                selectedPlan.totalPrice,
                selectedPlan.estimatedDurationMinutes,
                bookingId,
                userId
            ]);

            // Create worker assignments
            const assignments = [];
            for (const assign of selectedPlan.assignments) {
                const assignRes = await client.query(`
                    INSERT INTO multi_service_assignments (booking_id, worker_id, assigned_categories, status, worker_payout, arrival_eta_minutes)
                    VALUES ($1, $2, $3, 'PENDING_ACCEPTANCE', $4, $5)
                    RETURNING *
                `, [
                    bookingId,
                    assign.workerId,
                    JSON.stringify(assign.assignedCategories),
                    assign.payout,
                    Math.round(assign.distance * 5) + 15
                ]);

                assignments.push(assignRes.rows[0]);

                // Map items to ASSIGNED status
                const categoriesUpper = assign.assignedCategories.map(c => c.toUpperCase());
                await client.query(`
                    UPDATE multi_service_booking_items
                    SET status = 'ASSIGNED'
                    WHERE booking_id = $1 AND service_category = ANY($2::varchar[])
                `, [bookingId, categoriesUpper]);

                // Notify worker via Socket.IO
                const io = getIO();
                if (io) {
                    io.to(`worker:${assign.workerId}`).emit('new_multi_service_assignment', {
                        assignmentId: assignRes.rows[0].id,
                        bookingId,
                        categories: assign.assignedCategories,
                        payout: assign.payout,
                        etaMinutes: Math.round(assign.distance * 5) + 15
                    });
                }
            }

            await client.query('COMMIT');
            return { success: true, bookingId, assignments };
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    /**
     * Worker accepts their assignment slot
     */
    async workerAcceptsAssignment(assignmentId, workerId) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const assignRes = await client.query(`
                UPDATE multi_service_assignments
                SET status = 'ACCEPTED', accepted_at = NOW()
                WHERE id = $1 AND worker_id = $2 AND status = 'PENDING_ACCEPTANCE'
                RETURNING *
            `, [assignmentId, workerId]);

            if (assignRes.rowCount === 0) {
                throw new Error("Assignment not found or already processed.");
            }

            const assignment = assignRes.rows[0];

            // Get booking details
            const bookingRes = await client.query("SELECT * FROM multi_service_bookings WHERE id = $1", [assignment.booking_id]);
            const booking = bookingRes.rows[0];

            // Insert into worker_calendar
            await client.query(`
                INSERT INTO worker_calendar (worker_id, multi_service_booking_id, service_category, scheduled_start, estimated_duration_minutes, status)
                VALUES ($1, $2, $3, $4, $5, 'CONFIRMED')
            `, [
                workerId,
                booking.id,
                assignment.assigned_categories.join(', '),
                booking.scheduled_at,
                booking.estimated_duration_minutes
            ]);

            // Check if ALL assignments for this booking are accepted
            const allAssignsRes = await client.query("SELECT status FROM multi_service_assignments WHERE booking_id = $1", [booking.id]);
            const allAccepted = allAssignsRes.rows.every(r => r.status === 'ACCEPTED');

            if (allAccepted) {
                await client.query("UPDATE multi_service_bookings SET status = 'ACCEPTED' WHERE id = $1", [booking.id]);
            }

            await client.query('COMMIT');

            // Notify Customer via socket
            const io = getIO();
            if (io) {
                io.to(`user:${booking.user_id}`).emit('multi_booking_worker_accepted', {
                    bookingId: booking.id,
                    workerId,
                    status: allAccepted ? 'ACCEPTED' : 'PLAN_READY'
                });
            }

            return { success: true, bookingStatus: allAccepted ? 'ACCEPTED' : 'PLAN_READY' };
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    /**
     * Worker declines an assignment slot - triggers replan
     */
    async workerDeclinesAssignment(assignmentId, workerId) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const assignRes = await client.query(`
                UPDATE multi_service_assignments
                SET status = 'CANCELLED'
                WHERE id = $1 AND worker_id = $2
                RETURNING *
            `, [assignmentId, workerId]);

            if (assignRes.rowCount === 0) {
                throw new Error("Assignment not found.");
            }

            const assignment = assignRes.rows[0];

            // Revert booking items back to PENDING
            const categoriesUpper = assignment.assigned_categories.map(c => c.toUpperCase());
            await client.query(`
                UPDATE multi_service_booking_items
                SET status = 'PENDING'
                WHERE booking_id = $1 AND service_category = ANY($2::varchar[])
            `, [assignment.booking_id, categoriesUpper]);

            await client.query('COMMIT');

            // Trigger Dynamic Replanning for the cancelled categories
            await this.triggerReplan(assignment.booking_id, workerId);

            return { success: true };
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    /**
     * Worker suggests an additional service (preventing counter-offers)
     */
    async suggestAddon(bookingId, workerId, category, price, description = '') {
        const categoryClean = category.trim().toUpperCase();
        const addonRes = await db.query(`
            INSERT INTO multi_service_addon_offers (booking_id, worker_id, service_category, description, proposed_price, status, source)
            VALUES ($1, $2, $3, $4, $5, 'PENDING', 'WORKER_SUGGESTED')
            RETURNING *
        `, [bookingId, workerId, categoryClean, description, price]);

        const bookingRes = await db.query("SELECT user_id FROM multi_service_bookings WHERE id = $1", [bookingId]);
        const booking = bookingRes.rows[0];

        const io = getIO();
        if (io && booking) {
            io.to(`user:${booking.user_id}`).emit('addon_offer_received', {
                addonId: addonRes.rows[0].id,
                bookingId,
                workerId,
                category,
                price,
                description
            });
        }

        return addonRes.rows[0];
    }

    /**
     * Customer responds (accept/decline) to an addon service suggestion
     */
    async respondToAddon(addonId, userId, accepted) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const addonRes = await client.query(`
                UPDATE multi_service_addon_offers
                SET status = $1, responded_at = NOW()
                WHERE id = $2 AND status = 'PENDING'
                RETURNING *
            `, [accepted ? 'ACCEPTED' : 'DECLINED', addonId]);

            if (addonRes.rowCount === 0) {
                throw new Error("Addon suggestion not found or already processed.");
            }

            const addon = addonRes.rows[0];

            if (accepted) {
                const categoryUpper = addon.service_category.trim().toUpperCase();
                // 1. Create a new booking item
                await client.query(`
                    INSERT INTO multi_service_booking_items (booking_id, service_category, description, base_price, status)
                    VALUES ($1, $2, $3, $4, 'ASSIGNED')
                `, [addon.booking_id, categoryUpper, addon.description || 'Add-on service', addon.proposed_price]);
 
                // 2. Add to worker's existing assignment or create new
                const assignRes = await client.query(`
                    SELECT * FROM multi_service_assignments
                    WHERE booking_id = $1 AND worker_id = $2 AND status = 'ACCEPTED'
                `, [addon.booking_id, addon.worker_id]);
 
                if (assignRes.rowCount > 0) {
                    const assignment = assignRes.rows[0];
                    const updatedCategories = [...assignment.assigned_categories.map(c => c.toUpperCase()), categoryUpper];
                    const newPayout = parseFloat(assignment.worker_payout) + parseFloat(addon.proposed_price);
 
                    await client.query(`
                        UPDATE multi_service_assignments
                        SET assigned_categories = $1, worker_payout = $2
                        WHERE id = $3
                    `, [JSON.stringify(updatedCategories), newPayout, assignment.id]);
                } else {
                    // Create new assignment if they didn't have an active one accepted
                    await client.query(`
                        INSERT INTO multi_service_assignments (booking_id, worker_id, assigned_categories, status, worker_payout)
                        VALUES ($1, $2, $3, 'ACCEPTED', $4)
                    `, [addon.booking_id, addon.worker_id, JSON.stringify([categoryUpper]), addon.proposed_price]);
                }

                // 3. Update total price on parent booking
                await client.query(`
                    UPDATE multi_service_bookings
                    SET total_price = total_price + $1
                    WHERE id = $2
                `, [addon.proposed_price, addon.booking_id]);
            }

            await client.query('COMMIT');
            return { success: true, status: accepted ? 'ACCEPTED' : 'DECLINED' };
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    /**
     * Dynamic Replanning: Re-routes services of a cancelled/declined worker slot
     */
    async triggerReplan(bookingId, cancelledWorkerId) {
        const bookingRes = await db.query("SELECT * FROM multi_service_bookings WHERE id = $1", [bookingId]);
        const booking = bookingRes.rows[0];
        if (!booking) return;

        // 1. Find all categories that are currently PENDING
        const itemsRes = await db.query("SELECT service_category FROM multi_service_booking_items WHERE booking_id = $1 AND status = 'PENDING'", [bookingId]);
        const categoriesToReplan = itemsRes.rows.map(r => r.service_category);

        if (categoriesToReplan.length === 0) return;

        // 2. Fetch all candidates excluding the cancelled worker
        const optResult = await optimizer.findOptimalPlans(categoriesToReplan, booking.location_lat, booking.location_lng, booking.user_id);
        const candidates = optResult.plans;
        const filteredPlans = candidates.filter(plan => 
            !plan.assignments.some(a => a.workerId === cancelledWorkerId)
        );

        const bestPlan = filteredPlans[0];
        if (!bestPlan) {
            console.error(`🚨 [REPLAN-FAILED] No backup plans cover categories ${categoriesToReplan.join(', ')} for booking ${bookingId}`);
            return;
        }

        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            // Apply new assignments
            for (const assign of bestPlan.assignments) {
                const assignRes = await client.query(`
                    INSERT INTO multi_service_assignments (booking_id, worker_id, assigned_categories, status, worker_payout, arrival_eta_minutes)
                    VALUES ($1, $2, $3, 'PENDING_ACCEPTANCE', $4, $5)
                    RETURNING *
                `, [
                    bookingId,
                    assign.workerId,
                    JSON.stringify(assign.assignedCategories),
                    assign.payout,
                    Math.round(assign.distance * 5) + 15
                ]);

                // Map items to ASSIGNED status
                const categoriesUpper = assign.assignedCategories.map(c => c.toUpperCase());
                await client.query(`
                    UPDATE multi_service_booking_items
                    SET status = 'ASSIGNED'
                    WHERE booking_id = $1 AND service_category = ANY($2::varchar[])
                `, [bookingId, categoriesUpper]);

                // Notify new worker via socket
                const io = getIO();
                if (io) {
                    io.to(`worker:${assign.workerId}`).emit('new_multi_service_assignment', {
                        assignmentId: assignRes.rows[0].id,
                        bookingId,
                        categories: assign.assignedCategories,
                        payout: assign.payout,
                        etaMinutes: Math.round(assign.distance * 5) + 15
                    });
                }
            }

            // Update booking price and duration estimates
            await client.query(`
                UPDATE multi_service_bookings
                SET total_price = total_price + $1,
                    estimated_duration_minutes = estimated_duration_minutes + $2,
                    status = 'PLAN_READY',
                    updated_at = NOW()
                WHERE id = $3
            `, [bestPlan.totalPrice, bestPlan.estimatedDurationMinutes, bookingId]);

            await client.query('COMMIT');

            // Notify Customer of replan
            const io = getIO();
            if (io) {
                io.to(`user:${booking.user_id}`).emit('multi_booking_replanned', {
                    bookingId,
                    message: "One of your professionals cancelled. We've assigned a new professional to keep your booking active."
                });
            }
        } catch (e) {
            await client.query('ROLLBACK');
            console.error('[REPLAN-ERROR]', e.message);
        } finally {
            client.release();
        }
    }

    async naturalLanguageParseAndPlan(userId, text, location) {
        const lowerText = text.toLowerCase();
        const extracted = [];
        
        const mapping = {
            'AC REPAIR': ['ac', 'air conditioner', 'ac repair', 'ac service', 'refrigerator', 'fridge', 'appliance'],
            'FAN INSTALLATION': ['fan', 'ceiling fan', 'fan install'],
            'PLUMBING': ['tap', 'leak', 'pipe', 'plumb', 'sink', 'toilet', 'flush'],
            'PAINTING': ['paint', 'putty', 'wall paint', 'color work'],
            'CLEANING': ['clean', 'wash', 'sweep', 'sofa clean', 'house clean'],
            'TRADES': ['carpenter', 'weld', 'curtain', 'drill', 'furniture', 'door'],
            'ELECTRICAL': ['switch', 'wire', 'light', 'meter', 'inverter', 'fuse', 'bulb']
        };

        for (const [category, keywords] of Object.entries(mapping)) {
            if (keywords.some(kw => lowerText.includes(kw))) {
                extracted.push(category);
            }
        }

        if (extracted.length === 0) {
            extracted.push('ELECTRICAL');
        }

        const services = extracted.map(cat => {
            let price = 250.00;
            if (cat === 'AC REPAIR') price = 300.00;
            if (cat === 'PAINTING') price = 350.00;
            return {
                category: cat,
                price: price,
                description: `Requested via natural language: "${text}"`
            };
        });

        const result = await this.createBooking(userId, services, location);
        return {
            ...result,
            extractedCategories: extracted
        };
    }
}

module.exports = new MultiServiceBookingService();
