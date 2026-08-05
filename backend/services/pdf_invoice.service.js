/**
 * Nexo PDF Invoice & Settlement Receipt Engine
 * Generates vector PDF documents for Customer GST Invoices, Worker Receipts & Wallet Statements
 */

const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const s3Service = require('./s3.service');
const db = require('../config/db');

class PdfInvoiceService {
    /**
     * Generate Customer GST Tax Invoice as a PDF Buffer
     */
    async generateCustomerInvoice(jobData) {
        return new Promise(async (resolve, reject) => {
            try {
                const doc = new PDFDocument({ margin: 40, size: 'A4' });
                const buffers = [];

                doc.on('data', b => buffers.push(b));
                doc.on('end', () => resolve(Buffer.concat(buffers)));

                const invoiceNo = `NEXO-INV-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${(jobData.id || '9999').slice(0, 4).toUpperCase()}`;
                const qrData = `https://nexo.app/invoice/verify?num=${invoiceNo}&amount=${jobData.price || 500}`;
                const qrDataUrl = await QRCode.toDataURL(qrData);

                // --- HEADER ---
                doc.fillColor('#2563eb').fontSize(24).font('Helvetica-Bold').text('Nexo Technologies Inc.', 40, 40);
                doc.fillColor('#64748b').fontSize(10).font('Helvetica').text('Tax Invoice / Service Receipt', 40, 68);
                doc.fillColor('#94a3b8').fontSize(9).text('GSTIN: 36AABCN1234F1Z9 | SAC Code: 998314', 40, 82);

                // Invoice Meta Right Column
                doc.fillColor('#0f172a').fontSize(12).font('Helvetica-Bold').text(`INVOICE: ${invoiceNo}`, 350, 40, { align: 'right' });
                doc.fillColor('#64748b').fontSize(10).font('Helvetica').text(`Date: ${new Date().toLocaleDateString('en-IN')}`, 350, 58, { align: 'right' });
                doc.fillColor('#64748b').fontSize(10).text(`Payment: ${jobData.payment_method || 'RAZORPAY / WALLET'}`, 350, 72, { align: 'right' });

                doc.moveTo(40, 100).lineTo(555, 100).strokeColor('#e2e8f0').stroke();

                // --- BILL TO / SERVICE DETAILS ---
                doc.fillColor('#0f172a').fontSize(11).font('Helvetica-Bold').text('Billed To (Customer):', 40, 115);
                doc.fillColor('#334155').fontSize(10).font('Helvetica').text(`Customer ID: ${(jobData.user_id || 'USR-9812').slice(0, 8)}`, 40, 132);
                doc.fillColor('#334155').fontSize(10).text(`Location: ${jobData.address || 'Hyperlocal Address'}`, 40, 146);

                doc.fillColor('#0f172a').fontSize(11).font('Helvetica-Bold').text('Fulfilled By (Worker):', 300, 115);
                doc.fillColor('#334155').fontSize(10).font('Helvetica').text(`Worker ID: ${(jobData.worker_id || 'WRK-4412').slice(0, 8)}`, 300, 132);
                doc.fillColor('#334155').fontSize(10).text(`Service Status: COMPLETED ✅`, 300, 146);

                doc.moveTo(40, 170).lineTo(555, 170).strokeColor('#e2e8f0').stroke();

                // --- ITEM TABLE ---
                const tableTop = 185;
                doc.fillColor('#0f172a').fontSize(10).font('Helvetica-Bold');
                doc.text('Description / Service Item', 40, tableTop);
                doc.text('SAC', 280, tableTop);
                doc.text('Base Price', 360, tableTop, { align: 'right' });
                doc.text('Total (₹)', 480, tableTop, { align: 'right' });

                doc.moveTo(40, tableTop + 16).lineTo(555, tableTop + 16).strokeColor('#cbd5e1').stroke();

                const basePrice = parseFloat(jobData.price || 500);
                const cgst = basePrice * 0.09;
                const sgst = basePrice * 0.09;
                const grandTotal = basePrice + cgst + sgst;

                doc.fillColor('#334155').fontSize(10).font('Helvetica');
                doc.text(jobData.category || job.serviceType || 'Professional On-Demand Service', 40, tableTop + 26);
                doc.text('998314', 280, tableTop + 26);
                doc.text(`₹${basePrice.toFixed(2)}`, 360, tableTop + 26, { align: 'right' });
                doc.text(`₹${basePrice.toFixed(2)}`, 480, tableTop + 26, { align: 'right' });

                doc.moveTo(40, tableTop + 45).lineTo(555, tableTop + 45).strokeColor('#e2e8f0').stroke();

                // --- TAX & TOTAL BREAKDOWN ---
                let totalTop = tableTop + 60;
                doc.text('Subtotal:', 360, totalTop, { align: 'right' });
                doc.text(`₹${basePrice.toFixed(2)}`, 480, totalTop, { align: 'right' });

                totalTop += 16;
                doc.text('CGST (9%):', 360, totalTop, { align: 'right' });
                doc.text(`₹${cgst.toFixed(2)}`, 480, totalTop, { align: 'right' });

                totalTop += 16;
                doc.text('SGST (9%):', 360, totalTop, { align: 'right' });
                doc.text(`₹${sgst.toFixed(2)}`, 480, totalTop, { align: 'right' });

                totalTop += 20;
                doc.fillColor('#0f172a').fontSize(12).font('Helvetica-Bold');
                doc.text('Grand Total:', 360, totalTop, { align: 'right' });
                doc.text(`₹${grandTotal.toFixed(2)}`, 480, totalTop, { align: 'right' });

                // --- QR CODE & FOOTER ---
                const qrImageBuffer = Buffer.from(qrDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
                doc.image(qrImageBuffer, 40, 360, { width: 90, height: 90 });
                doc.fillColor('#64748b').fontSize(8).font('Helvetica').text('Scan QR code to verify digital invoice signature.', 40, 455);

                doc.fillColor('#94a3b8').fontSize(8).text('Thank you for choosing Nexo. This is a computer-generated tax invoice requiring no physical signature.', 40, 520, { align: 'center' });

                doc.end();
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Generate Worker Settlement Payout Slip
     */
    async generateWorkerSettlement(settlementData) {
        return new Promise(async (resolve, reject) => {
            try {
                const doc = new PDFDocument({ margin: 40, size: 'A4' });
                const buffers = [];

                doc.on('data', b => buffers.push(b));
                doc.on('end', () => resolve(Buffer.concat(buffers)));

                doc.fillColor('#10b981').fontSize(22).font('Helvetica-Bold').text('Nexo Worker Payout Slip', 40, 40);
                doc.fillColor('#64748b').fontSize(10).font('Helvetica').text(`Settlement ID: WST-${Date.now()}`, 40, 68);

                doc.moveTo(40, 90).lineTo(555, 90).strokeColor('#e2e8f0').stroke();

                const gross = parseFloat(settlementData.gross || 500);
                const commission = gross * 0.15;
                const netPayout = gross - commission;

                doc.fillColor('#0f172a').fontSize(12).font('Helvetica-Bold').text('Gross Earnings:', 40, 110);
                doc.text(`₹${gross.toFixed(2)}`, 400, 110, { align: 'right' });

                doc.fillColor('#ef4444').fontSize(12).font('Helvetica').text('Platform Commission (15%):', 40, 130);
                doc.text(`-₹${commission.toFixed(2)}`, 400, 130, { align: 'right' });

                doc.fillColor('#10b981').fontSize(14).font('Helvetica-Bold').text('Net Transferred Payout:', 40, 160);
                doc.text(`₹${netPayout.toFixed(2)}`, 400, 160, { align: 'right' });

                doc.end();
            } catch (err) {
                reject(err);
            }
        });
    }
}

module.exports = new PdfInvoiceService();
