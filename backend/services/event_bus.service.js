const EventEmitter = require('events');

class EventBusService {
    constructor() {
        this.emitter = new EventEmitter();
        this.emitter.setMaxListeners(100); // support high volume of subscribers
    }

    /**
     * Publishes an event to all subscribers.
     * @param {string} event 
     * @param {Object} payload 
     */
    publish(event, payload) {
        console.log(`📡 [EVENT-BUS] Publishing "${event}":`, JSON.stringify(payload));
        // Emit asynchronously to prevent blocking the publisher
        setImmediate(() => {
            this.emitter.emit(event, payload);
        });
    }

    /**
     * Subscribes a handler callback to a specific event.
     * @param {string} event 
     * @param {Function} handler 
     */
    subscribe(event, handler) {
        this.emitter.on(event, handler);
        console.log(`🔗 [EVENT-BUS] Subscribed to "${event}"`);
    }

    /**
     * Unsubscribes a handler callback.
     * @param {string} event 
     * @param {Function} handler 
     */
    unsubscribe(event, handler) {
        this.emitter.off(event, handler);
    }
}

module.exports = new EventBusService();
