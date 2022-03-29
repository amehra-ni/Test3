(function () {
    'use strict';

    /**
     * A reference to globalThis, with support
     * for browsers that don't yet support the spec.
     * @public
     */
    const $global = (function () {
        if (typeof globalThis !== "undefined") {
            // We're running in a modern environment.
            return globalThis;
        }
        if (typeof global !== "undefined") {
            // We're running in NodeJS
            return global;
        }
        if (typeof self !== "undefined") {
            // We're running in a worker.
            return self;
        }
        if (typeof window !== "undefined") {
            // We're running in the browser's main thread.
            return window;
        }
        try {
            // Hopefully we never get here...
            // Not all environments allow eval and Function. Use only as a last resort:
            // eslint-disable-next-line no-new-func
            return new Function("return this")();
        }
        catch (_a) {
            // If all fails, give up and create an object.
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            return {};
        }
    })();
    // API-only Polyfill for trustedTypes
    if ($global.trustedTypes === void 0) {
        $global.trustedTypes = { createPolicy: (n, r) => r };
    }
    const propConfig = {
        configurable: false,
        enumerable: false,
        writable: false,
    };
    if ($global.FAST === void 0) {
        Reflect.defineProperty($global, "FAST", Object.assign({ value: Object.create(null) }, propConfig));
    }
    /**
     * The FAST global.
     * @internal
     */
    const FAST = $global.FAST;
    if (FAST.getById === void 0) {
        const storage = Object.create(null);
        Reflect.defineProperty(FAST, "getById", Object.assign({ value(id, initialize) {
                let found = storage[id];
                if (found === void 0) {
                    found = initialize ? (storage[id] = initialize()) : null;
                }
                return found;
            } }, propConfig));
    }
    /**
     * A readonly, empty array.
     * @remarks
     * Typically returned by APIs that return arrays when there are
     * no actual items to return.
     * @internal
     */
    const emptyArray = Object.freeze([]);

    const updateQueue = $global.FAST.getById(1 /* updateQueue */, () => {
        const tasks = [];
        const pendingErrors = [];
        function throwFirstError() {
            if (pendingErrors.length) {
                throw pendingErrors.shift();
            }
        }
        function tryRunTask(task) {
            try {
                task.call();
            }
            catch (error) {
                pendingErrors.push(error);
                setTimeout(throwFirstError, 0);
            }
        }
        function process() {
            const capacity = 1024;
            let index = 0;
            while (index < tasks.length) {
                tryRunTask(tasks[index]);
                index++;
                // Prevent leaking memory for long chains of recursive calls to `DOM.queueUpdate`.
                // If we call `DOM.queueUpdate` within a task scheduled by `DOM.queueUpdate`, the queue will
                // grow, but to avoid an O(n) walk for every task we execute, we don't
                // shift tasks off the queue after they have been executed.
                // Instead, we periodically shift 1024 tasks off the queue.
                if (index > capacity) {
                    // Manually shift all values starting at the index back to the
                    // beginning of the queue.
                    for (let scan = 0, newLength = tasks.length - index; scan < newLength; scan++) {
                        tasks[scan] = tasks[scan + index];
                    }
                    tasks.length -= index;
                    index = 0;
                }
            }
            tasks.length = 0;
        }
        function enqueue(callable) {
            if (tasks.length < 1) {
                $global.requestAnimationFrame(process);
            }
            tasks.push(callable);
        }
        return Object.freeze({
            enqueue,
            process,
        });
    });
    /* eslint-disable */
    const fastHTMLPolicy = $global.trustedTypes.createPolicy("fast-html", {
        createHTML: html => html,
    });
    /* eslint-enable */
    let htmlPolicy = fastHTMLPolicy;
    const marker = `fast-${Math.random().toString(36).substring(2, 8)}`;
    /** @internal */
    const _interpolationStart = `${marker}{`;
    /** @internal */
    const _interpolationEnd = `}${marker}`;
    /**
     * Common DOM APIs.
     * @public
     */
    const DOM = Object.freeze({
        /**
         * Indicates whether the DOM supports the adoptedStyleSheets feature.
         */
        supportsAdoptedStyleSheets: Array.isArray(document.adoptedStyleSheets) &&
            "replace" in CSSStyleSheet.prototype,
        /**
         * Sets the HTML trusted types policy used by the templating engine.
         * @param policy - The policy to set for HTML.
         * @remarks
         * This API can only be called once, for security reasons. It should be
         * called by the application developer at the start of their program.
         */
        setHTMLPolicy(policy) {
            if (htmlPolicy !== fastHTMLPolicy) {
                throw new Error("The HTML policy can only be set once.");
            }
            htmlPolicy = policy;
        },
        /**
         * Turns a string into trusted HTML using the configured trusted types policy.
         * @param html - The string to turn into trusted HTML.
         * @remarks
         * Used internally by the template engine when creating templates
         * and setting innerHTML.
         */
        createHTML(html) {
            return htmlPolicy.createHTML(html);
        },
        /**
         * Determines if the provided node is a template marker used by the runtime.
         * @param node - The node to test.
         */
        isMarker(node) {
            return node && node.nodeType === 8 && node.data.startsWith(marker);
        },
        /**
         * Given a marker node, extract the {@link HTMLDirective} index from the placeholder.
         * @param node - The marker node to extract the index from.
         */
        extractDirectiveIndexFromMarker(node) {
            return parseInt(node.data.replace(`${marker}:`, ""));
        },
        /**
         * Creates a placeholder string suitable for marking out a location *within*
         * an attribute value or HTML content.
         * @param index - The directive index to create the placeholder for.
         * @remarks
         * Used internally by binding directives.
         */
        createInterpolationPlaceholder(index) {
            return `${_interpolationStart}${index}${_interpolationEnd}`;
        },
        /**
         * Creates a placeholder that manifests itself as an attribute on an
         * element.
         * @param attributeName - The name of the custom attribute.
         * @param index - The directive index to create the placeholder for.
         * @remarks
         * Used internally by attribute directives such as `ref`, `slotted`, and `children`.
         */
        createCustomAttributePlaceholder(attributeName, index) {
            return `${attributeName}="${this.createInterpolationPlaceholder(index)}"`;
        },
        /**
         * Creates a placeholder that manifests itself as a marker within the DOM structure.
         * @param index - The directive index to create the placeholder for.
         * @remarks
         * Used internally by structural directives such as `repeat`.
         */
        createBlockPlaceholder(index) {
            return `<!--${marker}:${index}-->`;
        },
        /**
         * Schedules DOM update work in the next async batch.
         * @param callable - The callable function or object to queue.
         */
        queueUpdate: updateQueue.enqueue,
        /**
         * Immediately processes all work previously scheduled
         * through queueUpdate.
         * @remarks
         * This also forces nextUpdate promises
         * to resolve.
         */
        processUpdates: updateQueue.process,
        /**
         * Resolves with the next DOM update.
         */
        nextUpdate() {
            return new Promise(updateQueue.enqueue);
        },
        /**
         * Sets an attribute value on an element.
         * @param element - The element to set the attribute value on.
         * @param attributeName - The attribute name to set.
         * @param value - The value of the attribute to set.
         * @remarks
         * If the value is `null` or `undefined`, the attribute is removed, otherwise
         * it is set to the provided value using the standard `setAttribute` API.
         */
        setAttribute(element, attributeName, value) {
            if (value === null || value === undefined) {
                element.removeAttribute(attributeName);
            }
            else {
                element.setAttribute(attributeName, value);
            }
        },
        /**
         * Sets a boolean attribute value.
         * @param element - The element to set the boolean attribute value on.
         * @param attributeName - The attribute name to set.
         * @param value - The value of the attribute to set.
         * @remarks
         * If the value is true, the attribute is added; otherwise it is removed.
         */
        setBooleanAttribute(element, attributeName, value) {
            value
                ? element.setAttribute(attributeName, "")
                : element.removeAttribute(attributeName);
        },
        /**
         * Removes all the child nodes of the provided parent node.
         * @param parent - The node to remove the children from.
         */
        removeChildNodes(parent) {
            for (let child = parent.firstChild; child !== null; child = parent.firstChild) {
                parent.removeChild(child);
            }
        },
        /**
         * Creates a TreeWalker configured to walk a template fragment.
         * @param fragment - The fragment to walk.
         */
        createTemplateWalker(fragment) {
            return document.createTreeWalker(fragment, 133, // element, text, comment
            null, false);
        },
    });

    function spilloverSubscribe(subscriber) {
        const spillover = this.spillover;
        const index = spillover.indexOf(subscriber);
        if (index === -1) {
            spillover.push(subscriber);
        }
    }
    function spilloverUnsubscribe(subscriber) {
        const spillover = this.spillover;
        const index = spillover.indexOf(subscriber);
        if (index !== -1) {
            spillover.splice(index, 1);
        }
    }
    function spilloverNotifySubscribers(args) {
        const spillover = this.spillover;
        const source = this.source;
        for (let i = 0, ii = spillover.length; i < ii; ++i) {
            spillover[i].handleChange(source, args);
        }
    }
    function spilloverHas(subscriber) {
        return this.spillover.indexOf(subscriber) !== -1;
    }
    /**
     * An implementation of {@link Notifier} that efficiently keeps track of
     * subscribers interested in a specific change notification on an
     * observable source.
     *
     * @remarks
     * This set is optimized for the most common scenario of 1 or 2 subscribers.
     * With this in mind, it can store a subscriber in an internal field, allowing it to avoid Array#push operations.
     * If the set ever exceeds two subscribers, it upgrades to an array automatically.
     * @public
     */
    class SubscriberSet {
        /**
         * Creates an instance of SubscriberSet for the specified source.
         * @param source - The object source that subscribers will receive notifications from.
         * @param initialSubscriber - An initial subscriber to changes.
         */
        constructor(source, initialSubscriber) {
            this.sub1 = void 0;
            this.sub2 = void 0;
            this.spillover = void 0;
            this.source = source;
            this.sub1 = initialSubscriber;
        }
        /**
         * Checks whether the provided subscriber has been added to this set.
         * @param subscriber - The subscriber to test for inclusion in this set.
         */
        has(subscriber) {
            return this.sub1 === subscriber || this.sub2 === subscriber;
        }
        /**
         * Subscribes to notification of changes in an object's state.
         * @param subscriber - The object that is subscribing for change notification.
         */
        subscribe(subscriber) {
            if (this.has(subscriber)) {
                return;
            }
            if (this.sub1 === void 0) {
                this.sub1 = subscriber;
                return;
            }
            if (this.sub2 === void 0) {
                this.sub2 = subscriber;
                return;
            }
            this.spillover = [this.sub1, this.sub2, subscriber];
            this.subscribe = spilloverSubscribe;
            this.unsubscribe = spilloverUnsubscribe;
            this.notify = spilloverNotifySubscribers;
            this.has = spilloverHas;
            this.sub1 = void 0;
            this.sub2 = void 0;
        }
        /**
         * Unsubscribes from notification of changes in an object's state.
         * @param subscriber - The object that is unsubscribing from change notification.
         */
        unsubscribe(subscriber) {
            if (this.sub1 === subscriber) {
                this.sub1 = void 0;
            }
            else if (this.sub2 === subscriber) {
                this.sub2 = void 0;
            }
        }
        /**
         * Notifies all subscribers.
         * @param args - Data passed along to subscribers during notification.
         */
        notify(args) {
            const sub1 = this.sub1;
            const sub2 = this.sub2;
            const source = this.source;
            if (sub1 !== void 0) {
                sub1.handleChange(source, args);
            }
            if (sub2 !== void 0) {
                sub2.handleChange(source, args);
            }
        }
    }
    /**
     * An implementation of Notifier that allows subscribers to be notified
     * of individual property changes on an object.
     * @public
     */
    class PropertyChangeNotifier {
        /**
         * Creates an instance of PropertyChangeNotifier for the specified source.
         * @param source - The object source that subscribers will receive notifications from.
         */
        constructor(source) {
            this.subscribers = {};
            this.sourceSubscribers = null;
            this.source = source;
        }
        /**
         * Notifies all subscribers, based on the specified property.
         * @param propertyName - The property name, passed along to subscribers during notification.
         */
        notify(propertyName) {
            var _a;
            const subscribers = this.subscribers[propertyName];
            if (subscribers !== void 0) {
                subscribers.notify(propertyName);
            }
            (_a = this.sourceSubscribers) === null || _a === void 0 ? void 0 : _a.notify(propertyName);
        }
        /**
         * Subscribes to notification of changes in an object's state.
         * @param subscriber - The object that is subscribing for change notification.
         * @param propertyToWatch - The name of the property that the subscriber is interested in watching for changes.
         */
        subscribe(subscriber, propertyToWatch) {
            var _a;
            if (propertyToWatch) {
                let subscribers = this.subscribers[propertyToWatch];
                if (subscribers === void 0) {
                    this.subscribers[propertyToWatch] = subscribers = new SubscriberSet(this.source);
                }
                subscribers.subscribe(subscriber);
            }
            else {
                this.sourceSubscribers = (_a = this.sourceSubscribers) !== null && _a !== void 0 ? _a : new SubscriberSet(this.source);
                this.sourceSubscribers.subscribe(subscriber);
            }
        }
        /**
         * Unsubscribes from notification of changes in an object's state.
         * @param subscriber - The object that is unsubscribing from change notification.
         * @param propertyToUnwatch - The name of the property that the subscriber is no longer interested in watching.
         */
        unsubscribe(subscriber, propertyToUnwatch) {
            var _a;
            if (propertyToUnwatch) {
                const subscribers = this.subscribers[propertyToUnwatch];
                if (subscribers !== void 0) {
                    subscribers.unsubscribe(subscriber);
                }
            }
            else {
                (_a = this.sourceSubscribers) === null || _a === void 0 ? void 0 : _a.unsubscribe(subscriber);
            }
        }
    }

    /**
     * Common Observable APIs.
     * @public
     */
    const Observable = FAST.getById(2 /* observable */, () => {
        const volatileRegex = /(:|&&|\|\||if)/;
        const notifierLookup = new WeakMap();
        const accessorLookup = new WeakMap();
        const queueUpdate = DOM.queueUpdate;
        let watcher = void 0;
        let createArrayObserver = (array) => {
            throw new Error("Must call enableArrayObservation before observing arrays.");
        };
        function getNotifier(source) {
            let found = source.$fastController || notifierLookup.get(source);
            if (found === void 0) {
                if (Array.isArray(source)) {
                    found = createArrayObserver(source);
                }
                else {
                    notifierLookup.set(source, (found = new PropertyChangeNotifier(source)));
                }
            }
            return found;
        }
        function getAccessors(target) {
            let accessors = accessorLookup.get(target);
            if (accessors === void 0) {
                let currentTarget = Reflect.getPrototypeOf(target);
                while (accessors === void 0 && currentTarget !== null) {
                    accessors = accessorLookup.get(currentTarget);
                    currentTarget = Reflect.getPrototypeOf(currentTarget);
                }
                if (accessors === void 0) {
                    accessors = [];
                }
                else {
                    accessors = accessors.slice(0);
                }
                accessorLookup.set(target, accessors);
            }
            return accessors;
        }
        class DefaultObservableAccessor {
            constructor(name) {
                this.name = name;
                this.field = `_${name}`;
                this.callback = `${name}Changed`;
            }
            getValue(source) {
                if (watcher !== void 0) {
                    watcher.watch(source, this.name);
                }
                return source[this.field];
            }
            setValue(source, newValue) {
                const field = this.field;
                const oldValue = source[field];
                if (oldValue !== newValue) {
                    source[field] = newValue;
                    const callback = source[this.callback];
                    if (typeof callback === "function") {
                        callback.call(source, oldValue, newValue);
                    }
                    getNotifier(source).notify(this.name);
                }
            }
        }
        class BindingObserverImplementation extends SubscriberSet {
            constructor(binding, initialSubscriber, isVolatileBinding = false) {
                super(binding, initialSubscriber);
                this.binding = binding;
                this.isVolatileBinding = isVolatileBinding;
                this.needsRefresh = true;
                this.needsQueue = true;
                this.first = this;
                this.last = null;
                this.propertySource = void 0;
                this.propertyName = void 0;
                this.notifier = void 0;
                this.next = void 0;
            }
            observe(source, context) {
                if (this.needsRefresh && this.last !== null) {
                    this.disconnect();
                }
                const previousWatcher = watcher;
                watcher = this.needsRefresh ? this : void 0;
                this.needsRefresh = this.isVolatileBinding;
                const result = this.binding(source, context);
                watcher = previousWatcher;
                return result;
            }
            disconnect() {
                if (this.last !== null) {
                    let current = this.first;
                    while (current !== void 0) {
                        current.notifier.unsubscribe(this, current.propertyName);
                        current = current.next;
                    }
                    this.last = null;
                    this.needsRefresh = this.needsQueue = true;
                }
            }
            watch(propertySource, propertyName) {
                const prev = this.last;
                const notifier = getNotifier(propertySource);
                const current = prev === null ? this.first : {};
                current.propertySource = propertySource;
                current.propertyName = propertyName;
                current.notifier = notifier;
                notifier.subscribe(this, propertyName);
                if (prev !== null) {
                    if (!this.needsRefresh) {
                        // Declaring the variable prior to assignment below circumvents
                        // a bug in Angular's optimization process causing infinite recursion
                        // of this watch() method. Details https://github.com/microsoft/fast/issues/4969
                        let prevValue;
                        watcher = void 0;
                        /* eslint-disable-next-line */
                        prevValue = prev.propertySource[prev.propertyName];
                        watcher = this;
                        if (propertySource === prevValue) {
                            this.needsRefresh = true;
                        }
                    }
                    prev.next = current;
                }
                this.last = current;
            }
            handleChange() {
                if (this.needsQueue) {
                    this.needsQueue = false;
                    queueUpdate(this);
                }
            }
            call() {
                if (this.last !== null) {
                    this.needsQueue = true;
                    this.notify(this);
                }
            }
            records() {
                let next = this.first;
                return {
                    next: () => {
                        const current = next;
                        if (current === undefined) {
                            return { value: void 0, done: true };
                        }
                        else {
                            next = next.next;
                            return {
                                value: current,
                                done: false,
                            };
                        }
                    },
                    [Symbol.iterator]: function () {
                        return this;
                    },
                };
            }
        }
        return Object.freeze({
            /**
             * @internal
             * @param factory - The factory used to create array observers.
             */
            setArrayObserverFactory(factory) {
                createArrayObserver = factory;
            },
            /**
             * Gets a notifier for an object or Array.
             * @param source - The object or Array to get the notifier for.
             */
            getNotifier,
            /**
             * Records a property change for a source object.
             * @param source - The object to record the change against.
             * @param propertyName - The property to track as changed.
             */
            track(source, propertyName) {
                if (watcher !== void 0) {
                    watcher.watch(source, propertyName);
                }
            },
            /**
             * Notifies watchers that the currently executing property getter or function is volatile
             * with respect to its observable dependencies.
             */
            trackVolatile() {
                if (watcher !== void 0) {
                    watcher.needsRefresh = true;
                }
            },
            /**
             * Notifies subscribers of a source object of changes.
             * @param source - the object to notify of changes.
             * @param args - The change args to pass to subscribers.
             */
            notify(source, args) {
                getNotifier(source).notify(args);
            },
            /**
             * Defines an observable property on an object or prototype.
             * @param target - The target object to define the observable on.
             * @param nameOrAccessor - The name of the property to define as observable;
             * or a custom accessor that specifies the property name and accessor implementation.
             */
            defineProperty(target, nameOrAccessor) {
                if (typeof nameOrAccessor === "string") {
                    nameOrAccessor = new DefaultObservableAccessor(nameOrAccessor);
                }
                getAccessors(target).push(nameOrAccessor);
                Reflect.defineProperty(target, nameOrAccessor.name, {
                    enumerable: true,
                    get: function () {
                        return nameOrAccessor.getValue(this);
                    },
                    set: function (newValue) {
                        nameOrAccessor.setValue(this, newValue);
                    },
                });
            },
            /**
             * Finds all the observable accessors defined on the target,
             * including its prototype chain.
             * @param target - The target object to search for accessor on.
             */
            getAccessors,
            /**
             * Creates a {@link BindingObserver} that can watch the
             * provided {@link Binding} for changes.
             * @param binding - The binding to observe.
             * @param initialSubscriber - An initial subscriber to changes in the binding value.
             * @param isVolatileBinding - Indicates whether the binding's dependency list must be re-evaluated on every value evaluation.
             */
            binding(binding, initialSubscriber, isVolatileBinding = this.isVolatileBinding(binding)) {
                return new BindingObserverImplementation(binding, initialSubscriber, isVolatileBinding);
            },
            /**
             * Determines whether a binding expression is volatile and needs to have its dependency list re-evaluated
             * on every evaluation of the value.
             * @param binding - The binding to inspect.
             */
            isVolatileBinding(binding) {
                return volatileRegex.test(binding.toString());
            },
        });
    });
    /**
     * Decorator: Defines an observable property on the target.
     * @param target - The target to define the observable on.
     * @param nameOrAccessor - The property name or accessor to define the observable as.
     * @public
     */
    function observable(target, nameOrAccessor) {
        Observable.defineProperty(target, nameOrAccessor);
    }
    const contextEvent = FAST.getById(3 /* contextEvent */, () => {
        let current = null;
        return {
            get() {
                return current;
            },
            set(event) {
                current = event;
            },
        };
    });
    /**
     * Provides additional contextual information available to behaviors and expressions.
     * @public
     */
    class ExecutionContext {
        constructor() {
            /**
             * The index of the current item within a repeat context.
             */
            this.index = 0;
            /**
             * The length of the current collection within a repeat context.
             */
            this.length = 0;
            /**
             * The parent data object within a repeat context.
             */
            this.parent = null;
            /**
             * The parent execution context when in nested context scenarios.
             */
            this.parentContext = null;
        }
        /**
         * The current event within an event handler.
         */
        get event() {
            return contextEvent.get();
        }
        /**
         * Indicates whether the current item within a repeat context
         * has an even index.
         */
        get isEven() {
            return this.index % 2 === 0;
        }
        /**
         * Indicates whether the current item within a repeat context
         * has an odd index.
         */
        get isOdd() {
            return this.index % 2 !== 0;
        }
        /**
         * Indicates whether the current item within a repeat context
         * is the first item in the collection.
         */
        get isFirst() {
            return this.index === 0;
        }
        /**
         * Indicates whether the current item within a repeat context
         * is somewhere in the middle of the collection.
         */
        get isInMiddle() {
            return !this.isFirst && !this.isLast;
        }
        /**
         * Indicates whether the current item within a repeat context
         * is the last item in the collection.
         */
        get isLast() {
            return this.index === this.length - 1;
        }
        /**
         * Sets the event for the current execution context.
         * @param event - The event to set.
         * @internal
         */
        static setEvent(event) {
            contextEvent.set(event);
        }
    }
    Observable.defineProperty(ExecutionContext.prototype, "index");
    Observable.defineProperty(ExecutionContext.prototype, "length");
    /**
     * The default execution context used in binding expressions.
     * @public
     */
    const defaultExecutionContext = Object.seal(new ExecutionContext());

    /**
     * Instructs the template engine to apply behavior to a node.
     * @public
     */
    class HTMLDirective {
        constructor() {
            /**
             * The index of the DOM node to which the created behavior will apply.
             */
            this.targetIndex = 0;
        }
    }
    /**
     * A {@link HTMLDirective} that targets a named attribute or property on a node.
     * @public
     */
    class TargetedHTMLDirective extends HTMLDirective {
        constructor() {
            super(...arguments);
            /**
             * Creates a placeholder string based on the directive's index within the template.
             * @param index - The index of the directive within the template.
             */
            this.createPlaceholder = DOM.createInterpolationPlaceholder;
        }
    }
    /**
     * A directive that attaches special behavior to an element via a custom attribute.
     * @public
     */
    class AttachedBehaviorHTMLDirective extends HTMLDirective {
        /**
         *
         * @param name - The name of the behavior; used as a custom attribute on the element.
         * @param behavior - The behavior to instantiate and attach to the element.
         * @param options - Options to pass to the behavior during creation.
         */
        constructor(name, behavior, options) {
            super();
            this.name = name;
            this.behavior = behavior;
            this.options = options;
        }
        /**
         * Creates a placeholder string based on the directive's index within the template.
         * @param index - The index of the directive within the template.
         * @remarks
         * Creates a custom attribute placeholder.
         */
        createPlaceholder(index) {
            return DOM.createCustomAttributePlaceholder(this.name, index);
        }
        /**
         * Creates a behavior for the provided target node.
         * @param target - The node instance to create the behavior for.
         * @remarks
         * Creates an instance of the `behavior` type this directive was constructed with
         * and passes the target and options to that `behavior`'s constructor.
         */
        createBehavior(target) {
            return new this.behavior(target, this.options);
        }
    }

    function normalBind(source, context) {
        this.source = source;
        this.context = context;
        if (this.bindingObserver === null) {
            this.bindingObserver = Observable.binding(this.binding, this, this.isBindingVolatile);
        }
        this.updateTarget(this.bindingObserver.observe(source, context));
    }
    function triggerBind(source, context) {
        this.source = source;
        this.context = context;
        this.target.addEventListener(this.targetName, this);
    }
    function normalUnbind() {
        this.bindingObserver.disconnect();
        this.source = null;
        this.context = null;
    }
    function contentUnbind() {
        this.bindingObserver.disconnect();
        this.source = null;
        this.context = null;
        const view = this.target.$fastView;
        if (view !== void 0 && view.isComposed) {
            view.unbind();
            view.needsBindOnly = true;
        }
    }
    function triggerUnbind() {
        this.target.removeEventListener(this.targetName, this);
        this.source = null;
        this.context = null;
    }
    function updateAttributeTarget(value) {
        DOM.setAttribute(this.target, this.targetName, value);
    }
    function updateBooleanAttributeTarget(value) {
        DOM.setBooleanAttribute(this.target, this.targetName, value);
    }
    function updateContentTarget(value) {
        // If there's no actual value, then this equates to the
        // empty string for the purposes of content bindings.
        if (value === null || value === undefined) {
            value = "";
        }
        // If the value has a "create" method, then it's a template-like.
        if (value.create) {
            this.target.textContent = "";
            let view = this.target.$fastView;
            // If there's no previous view that we might be able to
            // reuse then create a new view from the template.
            if (view === void 0) {
                view = value.create();
            }
            else {
                // If there is a previous view, but it wasn't created
                // from the same template as the new value, then we
                // need to remove the old view if it's still in the DOM
                // and create a new view from the template.
                if (this.target.$fastTemplate !== value) {
                    if (view.isComposed) {
                        view.remove();
                        view.unbind();
                    }
                    view = value.create();
                }
            }
            // It's possible that the value is the same as the previous template
            // and that there's actually no need to compose it.
            if (!view.isComposed) {
                view.isComposed = true;
                view.bind(this.source, this.context);
                view.insertBefore(this.target);
                this.target.$fastView = view;
                this.target.$fastTemplate = value;
            }
            else if (view.needsBindOnly) {
                view.needsBindOnly = false;
                view.bind(this.source, this.context);
            }
        }
        else {
            const view = this.target.$fastView;
            // If there is a view and it's currently composed into
            // the DOM, then we need to remove it.
            if (view !== void 0 && view.isComposed) {
                view.isComposed = false;
                view.remove();
                if (view.needsBindOnly) {
                    view.needsBindOnly = false;
                }
                else {
                    view.unbind();
                }
            }
            this.target.textContent = value;
        }
    }
    function updatePropertyTarget(value) {
        this.target[this.targetName] = value;
    }
    function updateClassTarget(value) {
        const classVersions = this.classVersions || Object.create(null);
        const target = this.target;
        let version = this.version || 0;
        // Add the classes, tracking the version at which they were added.
        if (value !== null && value !== undefined && value.length) {
            const names = value.split(/\s+/);
            for (let i = 0, ii = names.length; i < ii; ++i) {
                const currentName = names[i];
                if (currentName === "") {
                    continue;
                }
                classVersions[currentName] = version;
                target.classList.add(currentName);
            }
        }
        this.classVersions = classVersions;
        this.version = version + 1;
        // If this is the first call to add classes, there's no need to remove old ones.
        if (version === 0) {
            return;
        }
        // Remove classes from the previous version.
        version -= 1;
        for (const name in classVersions) {
            if (classVersions[name] === version) {
                target.classList.remove(name);
            }
        }
    }
    /**
     * A directive that configures data binding to element content and attributes.
     * @public
     */
    class HTMLBindingDirective extends TargetedHTMLDirective {
        /**
         * Creates an instance of BindingDirective.
         * @param binding - A binding that returns the data used to update the DOM.
         */
        constructor(binding) {
            super();
            this.binding = binding;
            this.bind = normalBind;
            this.unbind = normalUnbind;
            this.updateTarget = updateAttributeTarget;
            this.isBindingVolatile = Observable.isVolatileBinding(this.binding);
        }
        /**
         * Gets/sets the name of the attribute or property that this
         * binding is targeting.
         */
        get targetName() {
            return this.originalTargetName;
        }
        set targetName(value) {
            this.originalTargetName = value;
            if (value === void 0) {
                return;
            }
            switch (value[0]) {
                case ":":
                    this.cleanedTargetName = value.substr(1);
                    this.updateTarget = updatePropertyTarget;
                    if (this.cleanedTargetName === "innerHTML") {
                        const binding = this.binding;
                        this.binding = (s, c) => DOM.createHTML(binding(s, c));
                    }
                    break;
                case "?":
                    this.cleanedTargetName = value.substr(1);
                    this.updateTarget = updateBooleanAttributeTarget;
                    break;
                case "@":
                    this.cleanedTargetName = value.substr(1);
                    this.bind = triggerBind;
                    this.unbind = triggerUnbind;
                    break;
                default:
                    this.cleanedTargetName = value;
                    if (value === "class") {
                        this.updateTarget = updateClassTarget;
                    }
                    break;
            }
        }
        /**
         * Makes this binding target the content of an element rather than
         * a particular attribute or property.
         */
        targetAtContent() {
            this.updateTarget = updateContentTarget;
            this.unbind = contentUnbind;
        }
        /**
         * Creates the runtime BindingBehavior instance based on the configuration
         * information stored in the BindingDirective.
         * @param target - The target node that the binding behavior should attach to.
         */
        createBehavior(target) {
            /* eslint-disable-next-line @typescript-eslint/no-use-before-define */
            return new BindingBehavior(target, this.binding, this.isBindingVolatile, this.bind, this.unbind, this.updateTarget, this.cleanedTargetName);
        }
    }
    /**
     * A behavior that updates content and attributes based on a configured
     * BindingDirective.
     * @public
     */
    class BindingBehavior {
        /**
         * Creates an instance of BindingBehavior.
         * @param target - The target of the data updates.
         * @param binding - The binding that returns the latest value for an update.
         * @param isBindingVolatile - Indicates whether the binding has volatile dependencies.
         * @param bind - The operation to perform during binding.
         * @param unbind - The operation to perform during unbinding.
         * @param updateTarget - The operation to perform when updating.
         * @param targetName - The name of the target attribute or property to update.
         */
        constructor(target, binding, isBindingVolatile, bind, unbind, updateTarget, targetName) {
            /** @internal */
            this.source = null;
            /** @internal */
            this.context = null;
            /** @internal */
            this.bindingObserver = null;
            this.target = target;
            this.binding = binding;
            this.isBindingVolatile = isBindingVolatile;
            this.bind = bind;
            this.unbind = unbind;
            this.updateTarget = updateTarget;
            this.targetName = targetName;
        }
        /** @internal */
        handleChange() {
            this.updateTarget(this.bindingObserver.observe(this.source, this.context));
        }
        /** @internal */
        handleEvent(event) {
            ExecutionContext.setEvent(event);
            const result = this.binding(this.source, this.context);
            ExecutionContext.setEvent(null);
            if (result !== true) {
                event.preventDefault();
            }
        }
    }

    let sharedContext = null;
    class CompilationContext {
        addFactory(factory) {
            factory.targetIndex = this.targetIndex;
            this.behaviorFactories.push(factory);
        }
        captureContentBinding(directive) {
            directive.targetAtContent();
            this.addFactory(directive);
        }
        reset() {
            this.behaviorFactories = [];
            this.targetIndex = -1;
        }
        release() {
            sharedContext = this;
        }
        static borrow(directives) {
            const shareable = sharedContext || new CompilationContext();
            shareable.directives = directives;
            shareable.reset();
            sharedContext = null;
            return shareable;
        }
    }
    function createAggregateBinding(parts) {
        if (parts.length === 1) {
            return parts[0];
        }
        let targetName;
        const partCount = parts.length;
        const finalParts = parts.map((x) => {
            if (typeof x === "string") {
                return () => x;
            }
            targetName = x.targetName || targetName;
            return x.binding;
        });
        const binding = (scope, context) => {
            let output = "";
            for (let i = 0; i < partCount; ++i) {
                output += finalParts[i](scope, context);
            }
            return output;
        };
        const directive = new HTMLBindingDirective(binding);
        directive.targetName = targetName;
        return directive;
    }
    const interpolationEndLength = _interpolationEnd.length;
    function parseContent(context, value) {
        const valueParts = value.split(_interpolationStart);
        if (valueParts.length === 1) {
            return null;
        }
        const bindingParts = [];
        for (let i = 0, ii = valueParts.length; i < ii; ++i) {
            const current = valueParts[i];
            const index = current.indexOf(_interpolationEnd);
            let literal;
            if (index === -1) {
                literal = current;
            }
            else {
                const directiveIndex = parseInt(current.substring(0, index));
                bindingParts.push(context.directives[directiveIndex]);
                literal = current.substring(index + interpolationEndLength);
            }
            if (literal !== "") {
                bindingParts.push(literal);
            }
        }
        return bindingParts;
    }
    function compileAttributes(context, node, includeBasicValues = false) {
        const attributes = node.attributes;
        for (let i = 0, ii = attributes.length; i < ii; ++i) {
            const attr = attributes[i];
            const attrValue = attr.value;
            const parseResult = parseContent(context, attrValue);
            let result = null;
            if (parseResult === null) {
                if (includeBasicValues) {
                    result = new HTMLBindingDirective(() => attrValue);
                    result.targetName = attr.name;
                }
            }
            else {
                result = createAggregateBinding(parseResult);
            }
            if (result !== null) {
                node.removeAttributeNode(attr);
                i--;
                ii--;
                context.addFactory(result);
            }
        }
    }
    function compileContent(context, node, walker) {
        const parseResult = parseContent(context, node.textContent);
        if (parseResult !== null) {
            let lastNode = node;
            for (let i = 0, ii = parseResult.length; i < ii; ++i) {
                const currentPart = parseResult[i];
                const currentNode = i === 0
                    ? node
                    : lastNode.parentNode.insertBefore(document.createTextNode(""), lastNode.nextSibling);
                if (typeof currentPart === "string") {
                    currentNode.textContent = currentPart;
                }
                else {
                    currentNode.textContent = " ";
                    context.captureContentBinding(currentPart);
                }
                lastNode = currentNode;
                context.targetIndex++;
                if (currentNode !== node) {
                    walker.nextNode();
                }
            }
            context.targetIndex--;
        }
    }
    /**
     * Compiles a template and associated directives into a raw compilation
     * result which include a cloneable DocumentFragment and factories capable
     * of attaching runtime behavior to nodes within the fragment.
     * @param template - The template to compile.
     * @param directives - The directives referenced by the template.
     * @remarks
     * The template that is provided for compilation is altered in-place
     * and cannot be compiled again. If the original template must be preserved,
     * it is recommended that you clone the original and pass the clone to this API.
     * @public
     */
    function compileTemplate(template, directives) {
        const fragment = template.content;
        // https://bugs.chromium.org/p/chromium/issues/detail?id=1111864
        document.adoptNode(fragment);
        const context = CompilationContext.borrow(directives);
        compileAttributes(context, template, true);
        const hostBehaviorFactories = context.behaviorFactories;
        context.reset();
        const walker = DOM.createTemplateWalker(fragment);
        let node;
        while ((node = walker.nextNode())) {
            context.targetIndex++;
            switch (node.nodeType) {
                case 1: // element node
                    compileAttributes(context, node);
                    break;
                case 3: // text node
                    compileContent(context, node, walker);
                    break;
                case 8: // comment
                    if (DOM.isMarker(node)) {
                        context.addFactory(directives[DOM.extractDirectiveIndexFromMarker(node)]);
                    }
            }
        }
        let targetOffset = 0;
        if (
        // If the first node in a fragment is a marker, that means it's an unstable first node,
        // because something like a when, repeat, etc. could add nodes before the marker.
        // To mitigate this, we insert a stable first node. However, if we insert a node,
        // that will alter the result of the TreeWalker. So, we also need to offset the target index.
        DOM.isMarker(fragment.firstChild) ||
            // Or if there is only one node and a directive, it means the template's content
            // is *only* the directive. In that case, HTMLView.dispose() misses any nodes inserted by
            // the directive. Inserting a new node ensures proper disposal of nodes added by the directive.
            (fragment.childNodes.length === 1 && directives.length)) {
            fragment.insertBefore(document.createComment(""), fragment.firstChild);
            targetOffset = -1;
        }
        const viewBehaviorFactories = context.behaviorFactories;
        context.release();
        return {
            fragment,
            viewBehaviorFactories,
            hostBehaviorFactories,
            targetOffset,
        };
    }

    // A singleton Range instance used to efficiently remove ranges of DOM nodes.
    // See the implementation of HTMLView below for further details.
    const range = document.createRange();
    /**
     * The standard View implementation, which also implements ElementView and SyntheticView.
     * @public
     */
    class HTMLView {
        /**
         * Constructs an instance of HTMLView.
         * @param fragment - The html fragment that contains the nodes for this view.
         * @param behaviors - The behaviors to be applied to this view.
         */
        constructor(fragment, behaviors) {
            this.fragment = fragment;
            this.behaviors = behaviors;
            /**
             * The data that the view is bound to.
             */
            this.source = null;
            /**
             * The execution context the view is running within.
             */
            this.context = null;
            this.firstChild = fragment.firstChild;
            this.lastChild = fragment.lastChild;
        }
        /**
         * Appends the view's DOM nodes to the referenced node.
         * @param node - The parent node to append the view's DOM nodes to.
         */
        appendTo(node) {
            node.appendChild(this.fragment);
        }
        /**
         * Inserts the view's DOM nodes before the referenced node.
         * @param node - The node to insert the view's DOM before.
         */
        insertBefore(node) {
            if (this.fragment.hasChildNodes()) {
                node.parentNode.insertBefore(this.fragment, node);
            }
            else {
                const parentNode = node.parentNode;
                const end = this.lastChild;
                let current = this.firstChild;
                let next;
                while (current !== end) {
                    next = current.nextSibling;
                    parentNode.insertBefore(current, node);
                    current = next;
                }
                parentNode.insertBefore(end, node);
            }
        }
        /**
         * Removes the view's DOM nodes.
         * The nodes are not disposed and the view can later be re-inserted.
         */
        remove() {
            const fragment = this.fragment;
            const end = this.lastChild;
            let current = this.firstChild;
            let next;
            while (current !== end) {
                next = current.nextSibling;
                fragment.appendChild(current);
                current = next;
            }
            fragment.appendChild(end);
        }
        /**
         * Removes the view and unbinds its behaviors, disposing of DOM nodes afterward.
         * Once a view has been disposed, it cannot be inserted or bound again.
         */
        dispose() {
            const parent = this.firstChild.parentNode;
            const end = this.lastChild;
            let current = this.firstChild;
            let next;
            while (current !== end) {
                next = current.nextSibling;
                parent.removeChild(current);
                current = next;
            }
            parent.removeChild(end);
            const behaviors = this.behaviors;
            const oldSource = this.source;
            for (let i = 0, ii = behaviors.length; i < ii; ++i) {
                behaviors[i].unbind(oldSource);
            }
        }
        /**
         * Binds a view's behaviors to its binding source.
         * @param source - The binding source for the view's binding behaviors.
         * @param context - The execution context to run the behaviors within.
         */
        bind(source, context) {
            const behaviors = this.behaviors;
            if (this.source === source) {
                return;
            }
            else if (this.source !== null) {
                const oldSource = this.source;
                this.source = source;
                this.context = context;
                for (let i = 0, ii = behaviors.length; i < ii; ++i) {
                    const current = behaviors[i];
                    current.unbind(oldSource);
                    current.bind(source, context);
                }
            }
            else {
                this.source = source;
                this.context = context;
                for (let i = 0, ii = behaviors.length; i < ii; ++i) {
                    behaviors[i].bind(source, context);
                }
            }
        }
        /**
         * Unbinds a view's behaviors from its binding source.
         */
        unbind() {
            if (this.source === null) {
                return;
            }
            const behaviors = this.behaviors;
            const oldSource = this.source;
            for (let i = 0, ii = behaviors.length; i < ii; ++i) {
                behaviors[i].unbind(oldSource);
            }
            this.source = null;
        }
        /**
         * Efficiently disposes of a contiguous range of synthetic view instances.
         * @param views - A contiguous range of views to be disposed.
         */
        static disposeContiguousBatch(views) {
            if (views.length === 0) {
                return;
            }
            range.setStartBefore(views[0].firstChild);
            range.setEndAfter(views[views.length - 1].lastChild);
            range.deleteContents();
            for (let i = 0, ii = views.length; i < ii; ++i) {
                const view = views[i];
                const behaviors = view.behaviors;
                const oldSource = view.source;
                for (let j = 0, jj = behaviors.length; j < jj; ++j) {
                    behaviors[j].unbind(oldSource);
                }
            }
        }
    }

    /**
     * A template capable of creating HTMLView instances or rendering directly to DOM.
     * @public
     */
    /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
    class ViewTemplate {
        /**
         * Creates an instance of ViewTemplate.
         * @param html - The html representing what this template will instantiate, including placeholders for directives.
         * @param directives - The directives that will be connected to placeholders in the html.
         */
        constructor(html, directives) {
            this.behaviorCount = 0;
            this.hasHostBehaviors = false;
            this.fragment = null;
            this.targetOffset = 0;
            this.viewBehaviorFactories = null;
            this.hostBehaviorFactories = null;
            this.html = html;
            this.directives = directives;
        }
        /**
         * Creates an HTMLView instance based on this template definition.
         * @param hostBindingTarget - The element that host behaviors will be bound to.
         */
        create(hostBindingTarget) {
            if (this.fragment === null) {
                let template;
                const html = this.html;
                if (typeof html === "string") {
                    template = document.createElement("template");
                    template.innerHTML = DOM.createHTML(html);
                    const fec = template.content.firstElementChild;
                    if (fec !== null && fec.tagName === "TEMPLATE") {
                        template = fec;
                    }
                }
                else {
                    template = html;
                }
                const result = compileTemplate(template, this.directives);
                this.fragment = result.fragment;
                this.viewBehaviorFactories = result.viewBehaviorFactories;
                this.hostBehaviorFactories = result.hostBehaviorFactories;
                this.targetOffset = result.targetOffset;
                this.behaviorCount =
                    this.viewBehaviorFactories.length + this.hostBehaviorFactories.length;
                this.hasHostBehaviors = this.hostBehaviorFactories.length > 0;
            }
            const fragment = this.fragment.cloneNode(true);
            const viewFactories = this.viewBehaviorFactories;
            const behaviors = new Array(this.behaviorCount);
            const walker = DOM.createTemplateWalker(fragment);
            let behaviorIndex = 0;
            let targetIndex = this.targetOffset;
            let node = walker.nextNode();
            for (let ii = viewFactories.length; behaviorIndex < ii; ++behaviorIndex) {
                const factory = viewFactories[behaviorIndex];
                const factoryIndex = factory.targetIndex;
                while (node !== null) {
                    if (targetIndex === factoryIndex) {
                        behaviors[behaviorIndex] = factory.createBehavior(node);
                        break;
                    }
                    else {
                        node = walker.nextNode();
                        targetIndex++;
                    }
                }
            }
            if (this.hasHostBehaviors) {
                const hostFactories = this.hostBehaviorFactories;
                for (let i = 0, ii = hostFactories.length; i < ii; ++i, ++behaviorIndex) {
                    behaviors[behaviorIndex] = hostFactories[i].createBehavior(hostBindingTarget);
                }
            }
            return new HTMLView(fragment, behaviors);
        }
        /**
         * Creates an HTMLView from this template, binds it to the source, and then appends it to the host.
         * @param source - The data source to bind the template to.
         * @param host - The Element where the template will be rendered.
         * @param hostBindingTarget - An HTML element to target the host bindings at if different from the
         * host that the template is being attached to.
         */
        render(source, host, hostBindingTarget) {
            if (typeof host === "string") {
                host = document.getElementById(host);
            }
            if (hostBindingTarget === void 0) {
                hostBindingTarget = host;
            }
            const view = this.create(hostBindingTarget);
            view.bind(source, defaultExecutionContext);
            view.appendTo(host);
            return view;
        }
    }
    // Much thanks to LitHTML for working this out!
    const lastAttributeNameRegex = 
    /* eslint-disable-next-line no-control-regex */
    /([ \x09\x0a\x0c\x0d])([^\0-\x1F\x7F-\x9F "'>=/]+)([ \x09\x0a\x0c\x0d]*=[ \x09\x0a\x0c\x0d]*(?:[^ \x09\x0a\x0c\x0d"'`<>=]*|"[^"]*|'[^']*))$/;
    /**
     * Transforms a template literal string into a renderable ViewTemplate.
     * @param strings - The string fragments that are interpolated with the values.
     * @param values - The values that are interpolated with the string fragments.
     * @remarks
     * The html helper supports interpolation of strings, numbers, binding expressions,
     * other template instances, and Directive instances.
     * @public
     */
    function html(strings, ...values) {
        const directives = [];
        let html = "";
        for (let i = 0, ii = strings.length - 1; i < ii; ++i) {
            const currentString = strings[i];
            let value = values[i];
            html += currentString;
            if (value instanceof ViewTemplate) {
                const template = value;
                value = () => template;
            }
            if (typeof value === "function") {
                value = new HTMLBindingDirective(value);
            }
            if (value instanceof TargetedHTMLDirective) {
                const match = lastAttributeNameRegex.exec(currentString);
                if (match !== null) {
                    value.targetName = match[2];
                }
            }
            if (value instanceof HTMLDirective) {
                // Since not all values are directives, we can't use i
                // as the index for the placeholder. Instead, we need to
                // use directives.length to get the next index.
                html += value.createPlaceholder(directives.length);
                directives.push(value);
            }
            else {
                html += value;
            }
        }
        html += strings[strings.length - 1];
        return new ViewTemplate(html, directives);
    }

    /**
     * Represents styles that can be applied to a custom element.
     * @public
     */
    class ElementStyles {
        constructor() {
            this.targets = new WeakSet();
            /** @internal */
            this.behaviors = null;
        }
        /** @internal */
        addStylesTo(target) {
            this.targets.add(target);
        }
        /** @internal */
        removeStylesFrom(target) {
            this.targets.delete(target);
        }
        /** @internal */
        isAttachedTo(target) {
            return this.targets.has(target);
        }
        /**
         * Associates behaviors with this set of styles.
         * @param behaviors - The behaviors to associate.
         */
        withBehaviors(...behaviors) {
            this.behaviors =
                this.behaviors === null ? behaviors : this.behaviors.concat(behaviors);
            return this;
        }
    }
    /**
     * Create ElementStyles from ComposableStyles.
     */
    ElementStyles.create = (() => {
        if (DOM.supportsAdoptedStyleSheets) {
            const styleSheetCache = new Map();
            return (styles) => 
            // eslint-disable-next-line @typescript-eslint/no-use-before-define
            new AdoptedStyleSheetsStyles(styles, styleSheetCache);
        }
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        return (styles) => new StyleElementStyles(styles);
    })();
    function reduceStyles(styles) {
        return styles
            .map((x) => x instanceof ElementStyles ? reduceStyles(x.styles) : [x])
            .reduce((prev, curr) => prev.concat(curr), []);
    }
    function reduceBehaviors(styles) {
        return styles
            .map((x) => (x instanceof ElementStyles ? x.behaviors : null))
            .reduce((prev, curr) => {
            if (curr === null) {
                return prev;
            }
            if (prev === null) {
                prev = [];
            }
            return prev.concat(curr);
        }, null);
    }
    /**
     * https://wicg.github.io/construct-stylesheets/
     * https://developers.google.com/web/updates/2019/02/constructable-stylesheets
     *
     * @internal
     */
    class AdoptedStyleSheetsStyles extends ElementStyles {
        constructor(styles, styleSheetCache) {
            super();
            this.styles = styles;
            this.styleSheetCache = styleSheetCache;
            this._styleSheets = void 0;
            this.behaviors = reduceBehaviors(styles);
        }
        get styleSheets() {
            if (this._styleSheets === void 0) {
                const styles = this.styles;
                const styleSheetCache = this.styleSheetCache;
                this._styleSheets = reduceStyles(styles).map((x) => {
                    if (x instanceof CSSStyleSheet) {
                        return x;
                    }
                    let sheet = styleSheetCache.get(x);
                    if (sheet === void 0) {
                        sheet = new CSSStyleSheet();
                        sheet.replaceSync(x);
                        styleSheetCache.set(x, sheet);
                    }
                    return sheet;
                });
            }
            return this._styleSheets;
        }
        addStylesTo(target) {
            target.adoptedStyleSheets = [...target.adoptedStyleSheets, ...this.styleSheets];
            super.addStylesTo(target);
        }
        removeStylesFrom(target) {
            const sourceSheets = this.styleSheets;
            target.adoptedStyleSheets = target.adoptedStyleSheets.filter((x) => sourceSheets.indexOf(x) === -1);
            super.removeStylesFrom(target);
        }
    }
    let styleClassId = 0;
    function getNextStyleClass() {
        return `fast-style-class-${++styleClassId}`;
    }
    /**
     * @internal
     */
    class StyleElementStyles extends ElementStyles {
        constructor(styles) {
            super();
            this.styles = styles;
            this.behaviors = null;
            this.behaviors = reduceBehaviors(styles);
            this.styleSheets = reduceStyles(styles);
            this.styleClass = getNextStyleClass();
        }
        addStylesTo(target) {
            const styleSheets = this.styleSheets;
            const styleClass = this.styleClass;
            target = this.normalizeTarget(target);
            for (let i = 0; i < styleSheets.length; i++) {
                const element = document.createElement("style");
                element.innerHTML = styleSheets[i];
                element.className = styleClass;
                target.append(element);
            }
            super.addStylesTo(target);
        }
        removeStylesFrom(target) {
            target = this.normalizeTarget(target);
            const styles = target.querySelectorAll(`.${this.styleClass}`);
            for (let i = 0, ii = styles.length; i < ii; ++i) {
                target.removeChild(styles[i]);
            }
            super.removeStylesFrom(target);
        }
        isAttachedTo(target) {
            return super.isAttachedTo(this.normalizeTarget(target));
        }
        normalizeTarget(target) {
            return target === document ? document.body : target;
        }
    }

    /**
     * A {@link ValueConverter} that converts to and from `boolean` values.
     * @remarks
     * Used automatically when the `boolean` {@link AttributeMode} is selected.
     * @public
     */
    const booleanConverter = {
        toView(value) {
            return value ? "true" : "false";
        },
        fromView(value) {
            if (value === null ||
                value === void 0 ||
                value === "false" ||
                value === false ||
                value === 0) {
                return false;
            }
            return true;
        },
    };
    /**
     * A {@link ValueConverter} that converts to and from `number` values.
     * @remarks
     * This converter allows for nullable numbers, returning `null` if the
     * input was `null`, `undefined`, or `NaN`.
     * @public
     */
    const nullableNumberConverter = {
        toView(value) {
            if (value === null || value === undefined) {
                return null;
            }
            const number = value * 1;
            return isNaN(number) ? null : number.toString();
        },
        fromView(value) {
            if (value === null || value === undefined) {
                return null;
            }
            const number = value * 1;
            return isNaN(number) ? null : number;
        },
    };
    /**
     * An implementation of {@link Accessor} that supports reactivity,
     * change callbacks, attribute reflection, and type conversion for
     * custom elements.
     * @public
     */
    class AttributeDefinition {
        /**
         * Creates an instance of AttributeDefinition.
         * @param Owner - The class constructor that owns this attribute.
         * @param name - The name of the property associated with the attribute.
         * @param attribute - The name of the attribute in HTML.
         * @param mode - The {@link AttributeMode} that describes the behavior of this attribute.
         * @param converter - A {@link ValueConverter} that integrates with the property getter/setter
         * to convert values to and from a DOM string.
         */
        constructor(Owner, name, attribute = name.toLowerCase(), mode = "reflect", converter) {
            this.guards = new Set();
            this.Owner = Owner;
            this.name = name;
            this.attribute = attribute;
            this.mode = mode;
            this.converter = converter;
            this.fieldName = `_${name}`;
            this.callbackName = `${name}Changed`;
            this.hasCallback = this.callbackName in Owner.prototype;
            if (mode === "boolean" && converter === void 0) {
                this.converter = booleanConverter;
            }
        }
        /**
         * Sets the value of the attribute/property on the source element.
         * @param source - The source element to access.
         * @param value - The value to set the attribute/property to.
         */
        setValue(source, newValue) {
            const oldValue = source[this.fieldName];
            const converter = this.converter;
            if (converter !== void 0) {
                newValue = converter.fromView(newValue);
            }
            if (oldValue !== newValue) {
                source[this.fieldName] = newValue;
                this.tryReflectToAttribute(source);
                if (this.hasCallback) {
                    source[this.callbackName](oldValue, newValue);
                }
                source.$fastController.notify(this.name);
            }
        }
        /**
         * Gets the value of the attribute/property on the source element.
         * @param source - The source element to access.
         */
        getValue(source) {
            Observable.track(source, this.name);
            return source[this.fieldName];
        }
        /** @internal */
        onAttributeChangedCallback(element, value) {
            if (this.guards.has(element)) {
                return;
            }
            this.guards.add(element);
            this.setValue(element, value);
            this.guards.delete(element);
        }
        tryReflectToAttribute(element) {
            const mode = this.mode;
            const guards = this.guards;
            if (guards.has(element) || mode === "fromView") {
                return;
            }
            DOM.queueUpdate(() => {
                guards.add(element);
                const latestValue = element[this.fieldName];
                switch (mode) {
                    case "reflect":
                        const converter = this.converter;
                        DOM.setAttribute(element, this.attribute, converter !== void 0 ? converter.toView(latestValue) : latestValue);
                        break;
                    case "boolean":
                        DOM.setBooleanAttribute(element, this.attribute, latestValue);
                        break;
                }
                guards.delete(element);
            });
        }
        /**
         * Collects all attribute definitions associated with the owner.
         * @param Owner - The class constructor to collect attribute for.
         * @param attributeLists - Any existing attributes to collect and merge with those associated with the owner.
         * @internal
         */
        static collect(Owner, ...attributeLists) {
            const attributes = [];
            attributeLists.push(Owner.attributes);
            for (let i = 0, ii = attributeLists.length; i < ii; ++i) {
                const list = attributeLists[i];
                if (list === void 0) {
                    continue;
                }
                for (let j = 0, jj = list.length; j < jj; ++j) {
                    const config = list[j];
                    if (typeof config === "string") {
                        attributes.push(new AttributeDefinition(Owner, config));
                    }
                    else {
                        attributes.push(new AttributeDefinition(Owner, config.property, config.attribute, config.mode, config.converter));
                    }
                }
            }
            return attributes;
        }
    }
    function attr(configOrTarget, prop) {
        let config;
        function decorator($target, $prop) {
            if (arguments.length > 1) {
                // Non invocation:
                // - @attr
                // Invocation with or w/o opts:
                // - @attr()
                // - @attr({...opts})
                config.property = $prop;
            }
            const attributes = $target.constructor.attributes ||
                ($target.constructor.attributes = []);
            attributes.push(config);
        }
        if (arguments.length > 1) {
            // Non invocation:
            // - @attr
            config = {};
            decorator(configOrTarget, prop);
            return;
        }
        // Invocation with or w/o opts:
        // - @attr()
        // - @attr({...opts})
        config = configOrTarget === void 0 ? {} : configOrTarget;
        return decorator;
    }

    const defaultShadowOptions = { mode: "open" };
    const defaultElementOptions = {};
    const fastRegistry = FAST.getById(4 /* elementRegistry */, () => {
        const typeToDefinition = new Map();
        return Object.freeze({
            register(definition) {
                if (typeToDefinition.has(definition.type)) {
                    return false;
                }
                typeToDefinition.set(definition.type, definition);
                return true;
            },
            getByType(key) {
                return typeToDefinition.get(key);
            },
        });
    });
    /**
     * Defines metadata for a FASTElement.
     * @public
     */
    class FASTElementDefinition {
        /**
         * Creates an instance of FASTElementDefinition.
         * @param type - The type this definition is being created for.
         * @param nameOrConfig - The name of the element to define or a config object
         * that describes the element to define.
         */
        constructor(type, nameOrConfig = type.definition) {
            if (typeof nameOrConfig === "string") {
                nameOrConfig = { name: nameOrConfig };
            }
            this.type = type;
            this.name = nameOrConfig.name;
            this.template = nameOrConfig.template;
            const attributes = AttributeDefinition.collect(type, nameOrConfig.attributes);
            const observedAttributes = new Array(attributes.length);
            const propertyLookup = {};
            const attributeLookup = {};
            for (let i = 0, ii = attributes.length; i < ii; ++i) {
                const current = attributes[i];
                observedAttributes[i] = current.attribute;
                propertyLookup[current.name] = current;
                attributeLookup[current.attribute] = current;
            }
            this.attributes = attributes;
            this.observedAttributes = observedAttributes;
            this.propertyLookup = propertyLookup;
            this.attributeLookup = attributeLookup;
            this.shadowOptions =
                nameOrConfig.shadowOptions === void 0
                    ? defaultShadowOptions
                    : nameOrConfig.shadowOptions === null
                        ? void 0
                        : Object.assign(Object.assign({}, defaultShadowOptions), nameOrConfig.shadowOptions);
            this.elementOptions =
                nameOrConfig.elementOptions === void 0
                    ? defaultElementOptions
                    : Object.assign(Object.assign({}, defaultElementOptions), nameOrConfig.elementOptions);
            this.styles =
                nameOrConfig.styles === void 0
                    ? void 0
                    : Array.isArray(nameOrConfig.styles)
                        ? ElementStyles.create(nameOrConfig.styles)
                        : nameOrConfig.styles instanceof ElementStyles
                            ? nameOrConfig.styles
                            : ElementStyles.create([nameOrConfig.styles]);
        }
        /**
         * Indicates if this element has been defined in at least one registry.
         */
        get isDefined() {
            return !!fastRegistry.getByType(this.type);
        }
        /**
         * Defines a custom element based on this definition.
         * @param registry - The element registry to define the element in.
         */
        define(registry = customElements) {
            const type = this.type;
            if (fastRegistry.register(this)) {
                const attributes = this.attributes;
                const proto = type.prototype;
                for (let i = 0, ii = attributes.length; i < ii; ++i) {
                    Observable.defineProperty(proto, attributes[i]);
                }
                Reflect.defineProperty(type, "observedAttributes", {
                    value: this.observedAttributes,
                    enumerable: true,
                });
            }
            if (!registry.get(this.name)) {
                registry.define(this.name, type, this.elementOptions);
            }
            return this;
        }
    }
    /**
     * Gets the element definition associated with the specified type.
     * @param type - The custom element type to retrieve the definition for.
     */
    FASTElementDefinition.forType = fastRegistry.getByType;

    const shadowRoots = new WeakMap();
    const defaultEventOptions = {
        bubbles: true,
        composed: true,
        cancelable: true,
    };
    function getShadowRoot(element) {
        return element.shadowRoot || shadowRoots.get(element) || null;
    }
    /**
     * Controls the lifecycle and rendering of a `FASTElement`.
     * @public
     */
    class Controller extends PropertyChangeNotifier {
        /**
         * Creates a Controller to control the specified element.
         * @param element - The element to be controlled by this controller.
         * @param definition - The element definition metadata that instructs this
         * controller in how to handle rendering and other platform integrations.
         * @internal
         */
        constructor(element, definition) {
            super(element);
            this.boundObservables = null;
            this.behaviors = null;
            this.needsInitialization = true;
            this._template = null;
            this._styles = null;
            this._isConnected = false;
            /**
             * This allows Observable.getNotifier(...) to return the Controller
             * when the notifier for the Controller itself is being requested. The
             * result is that the Observable system does not need to create a separate
             * instance of Notifier for observables on the Controller. The component and
             * the controller will now share the same notifier, removing one-object construct
             * per web component instance.
             */
            this.$fastController = this;
            /**
             * The view associated with the custom element.
             * @remarks
             * If `null` then the element is managing its own rendering.
             */
            this.view = null;
            this.element = element;
            this.definition = definition;
            const shadowOptions = definition.shadowOptions;
            if (shadowOptions !== void 0) {
                const shadowRoot = element.attachShadow(shadowOptions);
                if (shadowOptions.mode === "closed") {
                    shadowRoots.set(element, shadowRoot);
                }
            }
            // Capture any observable values that were set by the binding engine before
            // the browser upgraded the element. Then delete the property since it will
            // shadow the getter/setter that is required to make the observable operate.
            // Later, in the connect callback, we'll re-apply the values.
            const accessors = Observable.getAccessors(element);
            if (accessors.length > 0) {
                const boundObservables = (this.boundObservables = Object.create(null));
                for (let i = 0, ii = accessors.length; i < ii; ++i) {
                    const propertyName = accessors[i].name;
                    const value = element[propertyName];
                    if (value !== void 0) {
                        delete element[propertyName];
                        boundObservables[propertyName] = value;
                    }
                }
            }
        }
        /**
         * Indicates whether or not the custom element has been
         * connected to the document.
         */
        get isConnected() {
            Observable.track(this, "isConnected");
            return this._isConnected;
        }
        setIsConnected(value) {
            this._isConnected = value;
            Observable.notify(this, "isConnected");
        }
        /**
         * Gets/sets the template used to render the component.
         * @remarks
         * This value can only be accurately read after connect but can be set at any time.
         */
        get template() {
            return this._template;
        }
        set template(value) {
            if (this._template === value) {
                return;
            }
            this._template = value;
            if (!this.needsInitialization) {
                this.renderTemplate(value);
            }
        }
        /**
         * Gets/sets the primary styles used for the component.
         * @remarks
         * This value can only be accurately read after connect but can be set at any time.
         */
        get styles() {
            return this._styles;
        }
        set styles(value) {
            if (this._styles === value) {
                return;
            }
            if (this._styles !== null) {
                this.removeStyles(this._styles);
            }
            this._styles = value;
            if (!this.needsInitialization && value !== null) {
                this.addStyles(value);
            }
        }
        /**
         * Adds styles to this element. Providing an HTMLStyleElement will attach the element instance to the shadowRoot.
         * @param styles - The styles to add.
         */
        addStyles(styles) {
            const target = getShadowRoot(this.element) ||
                this.element.getRootNode();
            if (styles instanceof HTMLStyleElement) {
                target.append(styles);
            }
            else if (!styles.isAttachedTo(target)) {
                const sourceBehaviors = styles.behaviors;
                styles.addStylesTo(target);
                if (sourceBehaviors !== null) {
                    this.addBehaviors(sourceBehaviors);
                }
            }
        }
        /**
         * Removes styles from this element. Providing an HTMLStyleElement will detach the element instance from the shadowRoot.
         * @param styles - the styles to remove.
         */
        removeStyles(styles) {
            const target = getShadowRoot(this.element) ||
                this.element.getRootNode();
            if (styles instanceof HTMLStyleElement) {
                target.removeChild(styles);
            }
            else if (styles.isAttachedTo(target)) {
                const sourceBehaviors = styles.behaviors;
                styles.removeStylesFrom(target);
                if (sourceBehaviors !== null) {
                    this.removeBehaviors(sourceBehaviors);
                }
            }
        }
        /**
         * Adds behaviors to this element.
         * @param behaviors - The behaviors to add.
         */
        addBehaviors(behaviors) {
            const targetBehaviors = this.behaviors || (this.behaviors = new Map());
            const length = behaviors.length;
            const behaviorsToBind = [];
            for (let i = 0; i < length; ++i) {
                const behavior = behaviors[i];
                if (targetBehaviors.has(behavior)) {
                    targetBehaviors.set(behavior, targetBehaviors.get(behavior) + 1);
                }
                else {
                    targetBehaviors.set(behavior, 1);
                    behaviorsToBind.push(behavior);
                }
            }
            if (this._isConnected) {
                const element = this.element;
                for (let i = 0; i < behaviorsToBind.length; ++i) {
                    behaviorsToBind[i].bind(element, defaultExecutionContext);
                }
            }
        }
        /**
         * Removes behaviors from this element.
         * @param behaviors - The behaviors to remove.
         * @param force - Forces unbinding of behaviors.
         */
        removeBehaviors(behaviors, force = false) {
            const targetBehaviors = this.behaviors;
            if (targetBehaviors === null) {
                return;
            }
            const length = behaviors.length;
            const behaviorsToUnbind = [];
            for (let i = 0; i < length; ++i) {
                const behavior = behaviors[i];
                if (targetBehaviors.has(behavior)) {
                    const count = targetBehaviors.get(behavior) - 1;
                    count === 0 || force
                        ? targetBehaviors.delete(behavior) && behaviorsToUnbind.push(behavior)
                        : targetBehaviors.set(behavior, count);
                }
            }
            if (this._isConnected) {
                const element = this.element;
                for (let i = 0; i < behaviorsToUnbind.length; ++i) {
                    behaviorsToUnbind[i].unbind(element);
                }
            }
        }
        /**
         * Runs connected lifecycle behavior on the associated element.
         */
        onConnectedCallback() {
            if (this._isConnected) {
                return;
            }
            const element = this.element;
            if (this.needsInitialization) {
                this.finishInitialization();
            }
            else if (this.view !== null) {
                this.view.bind(element, defaultExecutionContext);
            }
            const behaviors = this.behaviors;
            if (behaviors !== null) {
                for (const [behavior] of behaviors) {
                    behavior.bind(element, defaultExecutionContext);
                }
            }
            this.setIsConnected(true);
        }
        /**
         * Runs disconnected lifecycle behavior on the associated element.
         */
        onDisconnectedCallback() {
            if (!this._isConnected) {
                return;
            }
            this.setIsConnected(false);
            const view = this.view;
            if (view !== null) {
                view.unbind();
            }
            const behaviors = this.behaviors;
            if (behaviors !== null) {
                const element = this.element;
                for (const [behavior] of behaviors) {
                    behavior.unbind(element);
                }
            }
        }
        /**
         * Runs the attribute changed callback for the associated element.
         * @param name - The name of the attribute that changed.
         * @param oldValue - The previous value of the attribute.
         * @param newValue - The new value of the attribute.
         */
        onAttributeChangedCallback(name, oldValue, newValue) {
            const attrDef = this.definition.attributeLookup[name];
            if (attrDef !== void 0) {
                attrDef.onAttributeChangedCallback(this.element, newValue);
            }
        }
        /**
         * Emits a custom HTML event.
         * @param type - The type name of the event.
         * @param detail - The event detail object to send with the event.
         * @param options - The event options. By default bubbles and composed.
         * @remarks
         * Only emits events if connected.
         */
        emit(type, detail, options) {
            if (this._isConnected) {
                return this.element.dispatchEvent(new CustomEvent(type, Object.assign(Object.assign({ detail }, defaultEventOptions), options)));
            }
            return false;
        }
        finishInitialization() {
            const element = this.element;
            const boundObservables = this.boundObservables;
            // If we have any observables that were bound, re-apply their values.
            if (boundObservables !== null) {
                const propertyNames = Object.keys(boundObservables);
                for (let i = 0, ii = propertyNames.length; i < ii; ++i) {
                    const propertyName = propertyNames[i];
                    element[propertyName] = boundObservables[propertyName];
                }
                this.boundObservables = null;
            }
            const definition = this.definition;
            // 1. Template overrides take top precedence.
            if (this._template === null) {
                if (this.element.resolveTemplate) {
                    // 2. Allow for element instance overrides next.
                    this._template = this.element.resolveTemplate();
                }
                else if (definition.template) {
                    // 3. Default to the static definition.
                    this._template = definition.template || null;
                }
            }
            // If we have a template after the above process, render it.
            // If there's no template, then the element author has opted into
            // custom rendering and they will managed the shadow root's content themselves.
            if (this._template !== null) {
                this.renderTemplate(this._template);
            }
            // 1. Styles overrides take top precedence.
            if (this._styles === null) {
                if (this.element.resolveStyles) {
                    // 2. Allow for element instance overrides next.
                    this._styles = this.element.resolveStyles();
                }
                else if (definition.styles) {
                    // 3. Default to the static definition.
                    this._styles = definition.styles || null;
                }
            }
            // If we have styles after the above process, add them.
            if (this._styles !== null) {
                this.addStyles(this._styles);
            }
            this.needsInitialization = false;
        }
        renderTemplate(template) {
            const element = this.element;
            // When getting the host to render to, we start by looking
            // up the shadow root. If there isn't one, then that means
            // we're doing a Light DOM render to the element's direct children.
            const host = getShadowRoot(element) || element;
            if (this.view !== null) {
                // If there's already a view, we need to unbind and remove through dispose.
                this.view.dispose();
                this.view = null;
            }
            else if (!this.needsInitialization) {
                // If there was previous custom rendering, we need to clear out the host.
                DOM.removeChildNodes(host);
            }
            if (template) {
                // If a new template was provided, render it.
                this.view = template.render(element, host, element);
            }
        }
        /**
         * Locates or creates a controller for the specified element.
         * @param element - The element to return the controller for.
         * @remarks
         * The specified element must have a {@link FASTElementDefinition}
         * registered either through the use of the {@link customElement}
         * decorator or a call to `FASTElement.define`.
         */
        static forCustomElement(element) {
            const controller = element.$fastController;
            if (controller !== void 0) {
                return controller;
            }
            const definition = FASTElementDefinition.forType(element.constructor);
            if (definition === void 0) {
                throw new Error("Missing FASTElement definition.");
            }
            return (element.$fastController = new Controller(element, definition));
        }
    }

    /* eslint-disable-next-line @typescript-eslint/explicit-function-return-type */
    function createFASTElement(BaseType) {
        return class extends BaseType {
            constructor() {
                /* eslint-disable-next-line */
                super();
                Controller.forCustomElement(this);
            }
            $emit(type, detail, options) {
                return this.$fastController.emit(type, detail, options);
            }
            connectedCallback() {
                this.$fastController.onConnectedCallback();
            }
            disconnectedCallback() {
                this.$fastController.onDisconnectedCallback();
            }
            attributeChangedCallback(name, oldValue, newValue) {
                this.$fastController.onAttributeChangedCallback(name, oldValue, newValue);
            }
        };
    }
    /**
     * A minimal base class for FASTElements that also provides
     * static helpers for working with FASTElements.
     * @public
     */
    const FASTElement = Object.assign(createFASTElement(HTMLElement), {
        /**
         * Creates a new FASTElement base class inherited from the
         * provided base type.
         * @param BaseType - The base element type to inherit from.
         */
        from(BaseType) {
            return createFASTElement(BaseType);
        },
        /**
         * Defines a platform custom element based on the provided type and definition.
         * @param type - The custom element type to define.
         * @param nameOrDef - The name of the element to define or a definition object
         * that describes the element to define.
         */
        define(type, nameOrDef) {
            return new FASTElementDefinition(type, nameOrDef).define().type;
        },
    });

    /**
     * Directive for use in {@link css}.
     *
     * @public
     */
    class CSSDirective {
        /**
         * Creates a CSS fragment to interpolate into the CSS document.
         * @returns - the string to interpolate into CSS
         */
        createCSS() {
            return "";
        }
        /**
         * Creates a behavior to bind to the host element.
         * @returns - the behavior to bind to the host element, or undefined.
         */
        createBehavior() {
            return undefined;
        }
    }

    function collectStyles(strings, values) {
        const styles = [];
        let cssString = "";
        const behaviors = [];
        for (let i = 0, ii = strings.length - 1; i < ii; ++i) {
            cssString += strings[i];
            let value = values[i];
            if (value instanceof CSSDirective) {
                const behavior = value.createBehavior();
                value = value.createCSS();
                if (behavior) {
                    behaviors.push(behavior);
                }
            }
            if (value instanceof ElementStyles || value instanceof CSSStyleSheet) {
                if (cssString.trim() !== "") {
                    styles.push(cssString);
                    cssString = "";
                }
                styles.push(value);
            }
            else {
                cssString += value;
            }
        }
        cssString += strings[strings.length - 1];
        if (cssString.trim() !== "") {
            styles.push(cssString);
        }
        return {
            styles,
            behaviors,
        };
    }
    /**
     * Transforms a template literal string into styles.
     * @param strings - The string fragments that are interpolated with the values.
     * @param values - The values that are interpolated with the string fragments.
     * @remarks
     * The css helper supports interpolation of strings and ElementStyle instances.
     * @public
     */
    function css(strings, ...values) {
        const { styles, behaviors } = collectStyles(strings, values);
        const elementStyles = ElementStyles.create(styles);
        if (behaviors.length) {
            elementStyles.withBehaviors(...behaviors);
        }
        return elementStyles;
    }
    class CSSPartial extends CSSDirective {
        constructor(styles, behaviors) {
            super();
            this.behaviors = behaviors;
            this.css = "";
            const stylesheets = styles.reduce((accumulated, current) => {
                if (typeof current === "string") {
                    this.css += current;
                }
                else {
                    accumulated.push(current);
                }
                return accumulated;
            }, []);
            if (stylesheets.length) {
                this.styles = ElementStyles.create(stylesheets);
            }
        }
        createBehavior() {
            return this;
        }
        createCSS() {
            return this.css;
        }
        bind(el) {
            if (this.styles) {
                el.$fastController.addStyles(this.styles);
            }
            if (this.behaviors.length) {
                el.$fastController.addBehaviors(this.behaviors);
            }
        }
        unbind(el) {
            if (this.styles) {
                el.$fastController.removeStyles(this.styles);
            }
            if (this.behaviors.length) {
                el.$fastController.removeBehaviors(this.behaviors);
            }
        }
    }

    /**
     * The runtime behavior for template references.
     * @public
     */
    class RefBehavior {
        /**
         * Creates an instance of RefBehavior.
         * @param target - The element to reference.
         * @param propertyName - The name of the property to assign the reference to.
         */
        constructor(target, propertyName) {
            this.target = target;
            this.propertyName = propertyName;
        }
        /**
         * Bind this behavior to the source.
         * @param source - The source to bind to.
         * @param context - The execution context that the binding is operating within.
         */
        bind(source) {
            source[this.propertyName] = this.target;
        }
        /**
         * Unbinds this behavior from the source.
         * @param source - The source to unbind from.
         */
        /* eslint-disable-next-line @typescript-eslint/no-empty-function */
        unbind() { }
    }
    /**
     * A directive that observes the updates a property with a reference to the element.
     * @param propertyName - The name of the property to assign the reference to.
     * @public
     */
    function ref(propertyName) {
        return new AttachedBehaviorHTMLDirective("fast-ref", RefBehavior, propertyName);
    }

    /**
     * A directive that enables basic conditional rendering in a template.
     * @param binding - The condition to test for rendering.
     * @param templateOrTemplateBinding - The template or a binding that gets
     * the template to render when the condition is true.
     * @public
     */
    function when(binding, templateOrTemplateBinding) {
        const getTemplate = typeof templateOrTemplateBinding === "function"
            ? templateOrTemplateBinding
            : () => templateOrTemplateBinding;
        return (source, context) => binding(source, context) ? getTemplate(source, context) : null;
    }

    /**
     * Creates a function that can be used to filter a Node array, selecting only elements.
     * @param selector - An optional selector to restrict the filter to.
     * @public
     */
    function elements(selector) {
        if (selector) {
            return function (value, index, array) {
                return value.nodeType === 1 && value.matches(selector);
            };
        }
        return function (value, index, array) {
            return value.nodeType === 1;
        };
    }
    /**
     * A base class for node observation.
     * @internal
     */
    class NodeObservationBehavior {
        /**
         * Creates an instance of NodeObservationBehavior.
         * @param target - The target to assign the nodes property on.
         * @param options - The options to use in configuring node observation.
         */
        constructor(target, options) {
            this.target = target;
            this.options = options;
            this.source = null;
        }
        /**
         * Bind this behavior to the source.
         * @param source - The source to bind to.
         * @param context - The execution context that the binding is operating within.
         */
        bind(source) {
            const name = this.options.property;
            this.shouldUpdate = Observable.getAccessors(source).some((x) => x.name === name);
            this.source = source;
            this.updateTarget(this.computeNodes());
            if (this.shouldUpdate) {
                this.observe();
            }
        }
        /**
         * Unbinds this behavior from the source.
         * @param source - The source to unbind from.
         */
        unbind() {
            this.updateTarget(emptyArray);
            this.source = null;
            if (this.shouldUpdate) {
                this.disconnect();
            }
        }
        /** @internal */
        handleEvent() {
            this.updateTarget(this.computeNodes());
        }
        computeNodes() {
            let nodes = this.getNodes();
            if (this.options.filter !== void 0) {
                nodes = nodes.filter(this.options.filter);
            }
            return nodes;
        }
        updateTarget(value) {
            this.source[this.options.property] = value;
        }
    }

    /**
     * The runtime behavior for slotted node observation.
     * @public
     */
    class SlottedBehavior extends NodeObservationBehavior {
        /**
         * Creates an instance of SlottedBehavior.
         * @param target - The slot element target to observe.
         * @param options - The options to use when observing the slot.
         */
        constructor(target, options) {
            super(target, options);
        }
        /**
         * Begins observation of the nodes.
         */
        observe() {
            this.target.addEventListener("slotchange", this);
        }
        /**
         * Disconnects observation of the nodes.
         */
        disconnect() {
            this.target.removeEventListener("slotchange", this);
        }
        /**
         * Retrieves the nodes that should be assigned to the target.
         */
        getNodes() {
            return this.target.assignedNodes(this.options);
        }
    }
    /**
     * A directive that observes the `assignedNodes()` of a slot and updates a property
     * whenever they change.
     * @param propertyOrOptions - The options used to configure slotted node observation.
     * @public
     */
    function slotted(propertyOrOptions) {
        if (typeof propertyOrOptions === "string") {
            propertyOrOptions = { property: propertyOrOptions };
        }
        return new AttachedBehaviorHTMLDirective("fast-slotted", SlottedBehavior, propertyOrOptions);
    }

    /**
     * The runtime behavior for child node observation.
     * @public
     */
    class ChildrenBehavior extends NodeObservationBehavior {
        /**
         * Creates an instance of ChildrenBehavior.
         * @param target - The element target to observe children on.
         * @param options - The options to use when observing the element children.
         */
        constructor(target, options) {
            super(target, options);
            this.observer = null;
            options.childList = true;
        }
        /**
         * Begins observation of the nodes.
         */
        observe() {
            if (this.observer === null) {
                this.observer = new MutationObserver(this.handleEvent.bind(this));
            }
            this.observer.observe(this.target, this.options);
        }
        /**
         * Disconnects observation of the nodes.
         */
        disconnect() {
            this.observer.disconnect();
        }
        /**
         * Retrieves the nodes that should be assigned to the target.
         */
        getNodes() {
            if ("subtree" in this.options) {
                return Array.from(this.target.querySelectorAll(this.options.selector));
            }
            return Array.from(this.target.childNodes);
        }
    }
    /**
     * A directive that observes the `childNodes` of an element and updates a property
     * whenever they change.
     * @param propertyOrOptions - The options used to configure child node observation.
     * @public
     */
    function children(propertyOrOptions) {
        if (typeof propertyOrOptions === "string") {
            propertyOrOptions = {
                property: propertyOrOptions,
            };
        }
        return new AttachedBehaviorHTMLDirective("fast-children", ChildrenBehavior, propertyOrOptions);
    }

    /**
     * A mixin class implementing start and end elements.
     * These are generally used to decorate text elements with icons or other visual indicators.
     * @public
     */
    class StartEnd {
        handleStartContentChange() {
            this.startContainer.classList.toggle("start", this.start.assignedNodes().length > 0);
        }
        handleEndContentChange() {
            this.endContainer.classList.toggle("end", this.end.assignedNodes().length > 0);
        }
    }
    /**
     * The template for the end element.
     * For use with {@link StartEnd}
     *
     * @public
     */
    const endSlotTemplate = (context, definition) => html `
    <span
        part="end"
        ${ref("endContainer")}
        class=${x => (definition.end ? "end" : void 0)}
    >
        <slot name="end" ${ref("end")} @slotchange="${x => x.handleEndContentChange()}">
            ${definition.end || ""}
        </slot>
    </span>
`;
    /**
     * The template for the start element.
     * For use with {@link StartEnd}
     *
     * @public
     */
    const startSlotTemplate = (context, definition) => html `
    <span
        part="start"
        ${ref("startContainer")}
        class="${x => (definition.start ? "start" : void 0)}"
    >
        <slot
            name="start"
            ${ref("start")}
            @slotchange="${x => x.handleStartContentChange()}"
        >
            ${definition.start || ""}
        </slot>
    </span>
`;
    /**
     * The template for the end element.
     * For use with {@link StartEnd}
     *
     * @public
     * @deprecated - use endSlotTemplate
     */
    html `
    <span part="end" ${ref("endContainer")}>
        <slot
            name="end"
            ${ref("end")}
            @slotchange="${x => x.handleEndContentChange()}"
        ></slot>
    </span>
`;
    /**
     * The template for the start element.
     * For use with {@link StartEnd}
     *
     * @public
     * @deprecated - use startSlotTemplate
     */
    html `
    <span part="start" ${ref("startContainer")}>
        <slot
            name="start"
            ${ref("start")}
            @slotchange="${x => x.handleStartContentChange()}"
        ></slot>
    </span>
`;

    /*! *****************************************************************************
    Copyright (c) Microsoft Corporation.

    Permission to use, copy, modify, and/or distribute this software for any
    purpose with or without fee is hereby granted.

    THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
    REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
    AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
    INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
    LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
    OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
    PERFORMANCE OF THIS SOFTWARE.
    ***************************************************************************** */

    function __decorate$1(decorators, target, key, desc) {
        var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
        if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
        else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
        return c > 3 && r && Object.defineProperty(target, key, r), r;
    }

    /**
     * Big thanks to https://github.com/fkleuver and the https://github.com/aurelia/aurelia project
     * for the bulk of this code and many of the associated tests.
     */
    // Tiny polyfill for TypeScript's Reflect metadata API.
    const metadataByTarget = new Map();
    if (!("metadata" in Reflect)) {
        Reflect.metadata = function (key, value) {
            return function (target) {
                Reflect.defineMetadata(key, value, target);
            };
        };
        Reflect.defineMetadata = function (key, value, target) {
            let metadata = metadataByTarget.get(target);
            if (metadata === void 0) {
                metadataByTarget.set(target, (metadata = new Map()));
            }
            metadata.set(key, value);
        };
        Reflect.getOwnMetadata = function (key, target) {
            const metadata = metadataByTarget.get(target);
            if (metadata !== void 0) {
                return metadata.get(key);
            }
            return void 0;
        };
    }
    /**
     * A utility class used that constructs and registers resolvers for a dependency
     * injection container. Supports a standard set of object lifetimes.
     * @public
     */
    class ResolverBuilder {
        /**
         *
         * @param container - The container to create resolvers for.
         * @param key - The key to register resolvers under.
         */
        constructor(container, key) {
            this.container = container;
            this.key = key;
        }
        /**
         * Creates a resolver for an existing object instance.
         * @param value - The instance to resolve.
         * @returns The resolver.
         */
        instance(value) {
            return this.registerResolver(0 /* instance */, value);
        }
        /**
         * Creates a resolver that enforces a singleton lifetime.
         * @param value - The type to create and cache the singleton for.
         * @returns The resolver.
         */
        singleton(value) {
            return this.registerResolver(1 /* singleton */, value);
        }
        /**
         * Creates a resolver that creates a new instance for every dependency request.
         * @param value - The type to create instances of.
         * @returns - The resolver.
         */
        transient(value) {
            return this.registerResolver(2 /* transient */, value);
        }
        /**
         * Creates a resolver that invokes a callback function for every dependency resolution
         * request, allowing custom logic to return the dependency.
         * @param value - The callback to call during resolution.
         * @returns The resolver.
         */
        callback(value) {
            return this.registerResolver(3 /* callback */, value);
        }
        /**
         * Creates a resolver that invokes a callback function the first time that a dependency
         * resolution is requested. The returned value is then cached and provided for all
         * subsequent requests.
         * @param value - The callback to call during the first resolution.
         * @returns The resolver.
         */
        cachedCallback(value) {
            return this.registerResolver(3 /* callback */, cacheCallbackResult(value));
        }
        /**
         * Aliases the current key to a different key.
         * @param destinationKey - The key to point the alias to.
         * @returns The resolver.
         */
        aliasTo(destinationKey) {
            return this.registerResolver(5 /* alias */, destinationKey);
        }
        registerResolver(strategy, state) {
            const { container, key } = this;
            /* eslint-disable-next-line @typescript-eslint/no-non-null-assertion */
            this.container = this.key = (void 0);
            return container.registerResolver(key, new ResolverImpl(key, strategy, state));
        }
    }
    function cloneArrayWithPossibleProps(source) {
        const clone = source.slice();
        const keys = Object.keys(source);
        const len = keys.length;
        let key;
        for (let i = 0; i < len; ++i) {
            key = keys[i];
            if (!isArrayIndex(key)) {
                clone[key] = source[key];
            }
        }
        return clone;
    }
    /**
     * A set of default resolvers useful in configuring a container.
     * @public
     */
    const DefaultResolver = Object.freeze({
        /**
         * Disables auto-registration and throws for all un-registered dependencies.
         * @param key - The key to create the resolver for.
         */
        none(key) {
            throw Error(`${key.toString()} not registered, did you forget to add @singleton()?`);
        },
        /**
         * Provides default singleton resolution behavior during auto-registration.
         * @param key - The key to create the resolver for.
         * @returns The resolver.
         */
        singleton(key) {
            return new ResolverImpl(key, 1 /* singleton */, key);
        },
        /**
         * Provides default transient resolution behavior during auto-registration.
         * @param key - The key to create the resolver for.
         * @returns The resolver.
         */
        transient(key) {
            return new ResolverImpl(key, 2 /* transient */, key);
        },
    });
    /**
     * Configuration for a dependency injection container.
     * @public
     */
    const ContainerConfiguration = Object.freeze({
        /**
         * The default configuration used when creating a DOM-disconnected container.
         * @remarks
         * The default creates a root container, with no parent container. It does not handle
         * owner requests and it uses singleton resolution behavior for auto-registration.
         */
        default: Object.freeze({
            parentLocator: () => null,
            responsibleForOwnerRequests: false,
            defaultResolver: DefaultResolver.singleton,
        }),
    });
    const dependencyLookup = new Map();
    function getParamTypes(key) {
        return (Type) => {
            return Reflect.getOwnMetadata(key, Type);
        };
    }
    let rootDOMContainer = null;
    /**
     * The gateway to dependency injection APIs.
     * @public
     */
    const DI = Object.freeze({
        /**
         * Creates a new dependency injection container.
         * @param config - The configuration for the container.
         * @returns A newly created dependency injection container.
         */
        createContainer(config) {
            return new ContainerImpl(null, Object.assign({}, ContainerConfiguration.default, config));
        },
        /**
         * Finds the dependency injection container responsible for providing dependencies
         * to the specified node.
         * @param node - The node to find the responsible container for.
         * @returns The container responsible for providing dependencies to the node.
         * @remarks
         * This will be the same as the parent container if the specified node
         * does not itself host a container configured with responsibleForOwnerRequests.
         */
        findResponsibleContainer(node) {
            const owned = node.$$container$$;
            if (owned && owned.responsibleForOwnerRequests) {
                return owned;
            }
            return DI.findParentContainer(node);
        },
        /**
         * Find the dependency injection container up the DOM tree from this node.
         * @param node - The node to find the parent container for.
         * @returns The parent container of this node.
         * @remarks
         * This will be the same as the responsible container if the specified node
         * does not itself host a container configured with responsibleForOwnerRequests.
         */
        findParentContainer(node) {
            const event = new CustomEvent(DILocateParentEventType, {
                bubbles: true,
                composed: true,
                cancelable: true,
                detail: { container: void 0 },
            });
            node.dispatchEvent(event);
            return event.detail.container || DI.getOrCreateDOMContainer();
        },
        /**
         * Returns a dependency injection container if one is explicitly owned by the specified
         * node. If one is not owned, then a new container is created and assigned to the node.
         * @param node - The node to find or create the container for.
         * @param config - The configuration for the container if one needs to be created.
         * @returns The located or created container.
         * @remarks
         * This API does not search for a responsible or parent container. It looks only for a container
         * directly defined on the specified node and creates one at that location if one does not
         * already exist.
         */
        getOrCreateDOMContainer(node, config) {
            if (!node) {
                return (rootDOMContainer ||
                    (rootDOMContainer = new ContainerImpl(null, Object.assign({}, ContainerConfiguration.default, config, {
                        parentLocator: () => null,
                    }))));
            }
            return (node.$$container$$ ||
                new ContainerImpl(node, Object.assign({}, ContainerConfiguration.default, config, {
                    parentLocator: DI.findParentContainer,
                })));
        },
        /**
         * Gets the "design:paramtypes" metadata for the specified type.
         * @param Type - The type to get the metadata for.
         * @returns The metadata array or undefined if no metadata is found.
         */
        getDesignParamtypes: getParamTypes("design:paramtypes"),
        /**
         * Gets the "di:paramtypes" metadata for the specified type.
         * @param Type - The type to get the metadata for.
         * @returns The metadata array or undefined if no metadata is found.
         */
        getAnnotationParamtypes: getParamTypes("di:paramtypes"),
        /**
         *
         * @param Type - Gets the "di:paramtypes" metadata for the specified type. If none is found,
         * an empty metadata array is created and added.
         * @returns The metadata array.
         */
        getOrCreateAnnotationParamTypes(Type) {
            let annotationParamtypes = this.getAnnotationParamtypes(Type);
            if (annotationParamtypes === void 0) {
                Reflect.defineMetadata("di:paramtypes", (annotationParamtypes = []), Type);
            }
            return annotationParamtypes;
        },
        /**
         * Gets the dependency keys representing what is needed to instantiate the specified type.
         * @param Type - The type to get the dependencies for.
         * @returns An array of dependency keys.
         */
        getDependencies(Type) {
            // Note: Every detail of this getDependencies method is pretty deliberate at the moment, and probably not yet 100% tested from every possible angle,
            // so be careful with making changes here as it can have a huge impact on complex end user apps.
            // Preferably, only make changes to the dependency resolution process via a RFC.
            let dependencies = dependencyLookup.get(Type);
            if (dependencies === void 0) {
                // Type.length is the number of constructor parameters. If this is 0, it could mean the class has an empty constructor
                // but it could also mean the class has no constructor at all (in which case it inherits the constructor from the prototype).
                // Non-zero constructor length + no paramtypes means emitDecoratorMetadata is off, or the class has no decorator.
                // We're not doing anything with the above right now, but it's good to keep in mind for any future issues.
                const inject = Type.inject;
                if (inject === void 0) {
                    // design:paramtypes is set by tsc when emitDecoratorMetadata is enabled.
                    const designParamtypes = DI.getDesignParamtypes(Type);
                    // di:paramtypes is set by the parameter decorator from DI.createInterface or by @inject
                    const annotationParamtypes = DI.getAnnotationParamtypes(Type);
                    if (designParamtypes === void 0) {
                        if (annotationParamtypes === void 0) {
                            // Only go up the prototype if neither static inject nor any of the paramtypes is defined, as
                            // there is no sound way to merge a type's deps with its prototype's deps
                            const Proto = Object.getPrototypeOf(Type);
                            if (typeof Proto === "function" && Proto !== Function.prototype) {
                                dependencies = cloneArrayWithPossibleProps(DI.getDependencies(Proto));
                            }
                            else {
                                dependencies = [];
                            }
                        }
                        else {
                            // No design:paramtypes so just use the di:paramtypes
                            dependencies = cloneArrayWithPossibleProps(annotationParamtypes);
                        }
                    }
                    else if (annotationParamtypes === void 0) {
                        // No di:paramtypes so just use the design:paramtypes
                        dependencies = cloneArrayWithPossibleProps(designParamtypes);
                    }
                    else {
                        // We've got both, so merge them (in case of conflict on same index, di:paramtypes take precedence)
                        dependencies = cloneArrayWithPossibleProps(designParamtypes);
                        let len = annotationParamtypes.length;
                        let auAnnotationParamtype;
                        for (let i = 0; i < len; ++i) {
                            auAnnotationParamtype = annotationParamtypes[i];
                            if (auAnnotationParamtype !== void 0) {
                                dependencies[i] = auAnnotationParamtype;
                            }
                        }
                        const keys = Object.keys(annotationParamtypes);
                        len = keys.length;
                        let key;
                        for (let i = 0; i < len; ++i) {
                            key = keys[i];
                            if (!isArrayIndex(key)) {
                                dependencies[key] = annotationParamtypes[key];
                            }
                        }
                    }
                }
                else {
                    // Ignore paramtypes if we have static inject
                    dependencies = cloneArrayWithPossibleProps(inject);
                }
                dependencyLookup.set(Type, dependencies);
            }
            return dependencies;
        },
        /**
         * Defines a property on a web component class. The value of this property will
         * be resolved from the dependency injection container responsible for the element
         * instance, based on where it is connected in the DOM.
         * @param target - The target to define the property on.
         * @param propertyName - The name of the property to define.
         * @param key - The dependency injection key.
         * @param respectConnection - Indicates whether or not to update the property value if the
         * hosting component is disconnected and then re-connected at a different location in the DOM.
         * @remarks
         * The respectConnection option is only applicable to elements that descend from FASTElement.
         */
        defineProperty(target, propertyName, key, respectConnection = false) {
            const diPropertyKey = `$di_${propertyName}`;
            Reflect.defineProperty(target, propertyName, {
                get: function () {
                    let value = this[diPropertyKey];
                    if (value === void 0) {
                        const container = this instanceof HTMLElement
                            ? DI.findResponsibleContainer(this)
                            : DI.getOrCreateDOMContainer();
                        value = container.get(key);
                        this[diPropertyKey] = value;
                        if (respectConnection && this instanceof FASTElement) {
                            const notifier = this.$fastController;
                            const handleChange = () => {
                                const newContainer = DI.findResponsibleContainer(this);
                                const newValue = newContainer.get(key);
                                const oldValue = this[diPropertyKey];
                                if (newValue !== oldValue) {
                                    this[diPropertyKey] = value;
                                    notifier.notify(propertyName);
                                }
                            };
                            notifier.subscribe({ handleChange }, "isConnected");
                        }
                    }
                    return value;
                },
            });
        },
        /**
         * Creates a dependency injection key.
         * @param nameConfigOrCallback - A friendly name for the key or a lambda that configures a
         * default resolution for the dependency.
         * @param configuror - If a friendly name was provided for the first parameter, then an optional
         * lambda that configures a default resolution for the dependency can be provided second.
         * @returns The created key.
         * @remarks
         * The created key can be used as a property decorator or constructor parameter decorator,
         * in addition to its standard use in an inject array or through direct container APIs.
         */
        createInterface(nameConfigOrCallback, configuror) {
            const configure = typeof nameConfigOrCallback === "function"
                ? nameConfigOrCallback
                : configuror;
            const friendlyName = typeof nameConfigOrCallback === "string"
                ? nameConfigOrCallback
                : nameConfigOrCallback && "friendlyName" in nameConfigOrCallback
                    ? nameConfigOrCallback.friendlyName || defaultFriendlyName
                    : defaultFriendlyName;
            const respectConnection = typeof nameConfigOrCallback === "string"
                ? false
                : nameConfigOrCallback && "respectConnection" in nameConfigOrCallback
                    ? nameConfigOrCallback.respectConnection || false
                    : false;
            const Interface = function (target, property, index) {
                if (target == null || new.target !== undefined) {
                    throw new Error(`No registration for interface: '${Interface.friendlyName}'`);
                }
                if (property) {
                    DI.defineProperty(target, property, Interface, respectConnection);
                }
                else {
                    const annotationParamtypes = DI.getOrCreateAnnotationParamTypes(target);
                    annotationParamtypes[index] = Interface;
                }
            };
            Interface.$isInterface = true;
            Interface.friendlyName = friendlyName == null ? "(anonymous)" : friendlyName;
            if (configure != null) {
                Interface.register = function (container, key) {
                    return configure(new ResolverBuilder(container, key !== null && key !== void 0 ? key : Interface));
                };
            }
            Interface.toString = function toString() {
                return `InterfaceSymbol<${Interface.friendlyName}>`;
            };
            return Interface;
        },
        /**
         * A decorator that specifies what to inject into its target.
         * @param dependencies - The dependencies to inject.
         * @returns The decorator to be applied to the target class.
         * @remarks
         * The decorator can be used to decorate a class, listing all of the classes dependencies.
         * Or it can be used to decorate a constructor paramter, indicating what to inject for that
         * parameter.
         * Or it can be used for a web component property, indicating what that property should resolve to.
         */
        inject(...dependencies) {
            return function (target, key, descriptor) {
                if (typeof descriptor === "number") {
                    // It's a parameter decorator.
                    const annotationParamtypes = DI.getOrCreateAnnotationParamTypes(target);
                    const dep = dependencies[0];
                    if (dep !== void 0) {
                        annotationParamtypes[descriptor] = dep;
                    }
                }
                else if (key) {
                    DI.defineProperty(target, key, dependencies[0]);
                }
                else {
                    const annotationParamtypes = descriptor
                        ? DI.getOrCreateAnnotationParamTypes(descriptor.value)
                        : DI.getOrCreateAnnotationParamTypes(target);
                    let dep;
                    for (let i = 0; i < dependencies.length; ++i) {
                        dep = dependencies[i];
                        if (dep !== void 0) {
                            annotationParamtypes[i] = dep;
                        }
                    }
                }
            };
        },
        /**
         * Registers the `target` class as a transient dependency; each time the dependency is resolved
         * a new instance will be created.
         *
         * @param target - The class / constructor function to register as transient.
         * @returns The same class, with a static `register` method that takes a container and returns the appropriate resolver.
         *
         * @example
         * On an existing class
         * ```ts
         * class Foo { }
         * DI.transient(Foo);
         * ```
         *
         * @example
         * Inline declaration
         *
         * ```ts
         * const Foo = DI.transient(class { });
         * // Foo is now strongly typed with register
         * Foo.register(container);
         * ```
         *
         * @public
         */
        transient(target) {
            target.register = function register(container) {
                const registration = Registration.transient(target, target);
                return registration.register(container);
            };
            target.registerInRequestor = false;
            return target;
        },
        /**
         * Registers the `target` class as a singleton dependency; the class will only be created once. Each
         * consecutive time the dependency is resolved, the same instance will be returned.
         *
         * @param target - The class / constructor function to register as a singleton.
         * @returns The same class, with a static `register` method that takes a container and returns the appropriate resolver.
         * @example
         * On an existing class
         * ```ts
         * class Foo { }
         * DI.singleton(Foo);
         * ```
         *
         * @example
         * Inline declaration
         * ```ts
         * const Foo = DI.singleton(class { });
         * // Foo is now strongly typed with register
         * Foo.register(container);
         * ```
         *
         * @public
         */
        singleton(target, options = defaultSingletonOptions) {
            target.register = function register(container) {
                const registration = Registration.singleton(target, target);
                return registration.register(container);
            };
            target.registerInRequestor = options.scoped;
            return target;
        },
    });
    /**
     * The interface key that resolves the dependency injection container itself.
     * @public
     */
    const Container = DI.createInterface("Container");
    /**
     * A decorator that specifies what to inject into its target.
     * @param dependencies - The dependencies to inject.
     * @returns The decorator to be applied to the target class.
     * @remarks
     * The decorator can be used to decorate a class, listing all of the classes dependencies.
     * Or it can be used to decorate a constructor paramter, indicating what to inject for that
     * parameter.
     * Or it can be used for a web component property, indicating what that property should resolve to.
     *
     * @public
     */
    DI.inject;
    const defaultSingletonOptions = { scoped: false };
    /** @internal */
    class ResolverImpl {
        constructor(key, strategy, state) {
            this.key = key;
            this.strategy = strategy;
            this.state = state;
            this.resolving = false;
        }
        get $isResolver() {
            return true;
        }
        register(container) {
            return container.registerResolver(this.key, this);
        }
        resolve(handler, requestor) {
            switch (this.strategy) {
                case 0 /* instance */:
                    return this.state;
                case 1 /* singleton */: {
                    if (this.resolving) {
                        throw new Error(`Cyclic dependency found: ${this.state.name}`);
                    }
                    this.resolving = true;
                    this.state = handler
                        .getFactory(this.state)
                        .construct(requestor);
                    this.strategy = 0 /* instance */;
                    this.resolving = false;
                    return this.state;
                }
                case 2 /* transient */: {
                    // Always create transients from the requesting container
                    const factory = handler.getFactory(this.state);
                    if (factory === null) {
                        throw new Error(`Resolver for ${String(this.key)} returned a null factory`);
                    }
                    return factory.construct(requestor);
                }
                case 3 /* callback */:
                    return this.state(handler, requestor, this);
                case 4 /* array */:
                    return this.state[0].resolve(handler, requestor);
                case 5 /* alias */:
                    return requestor.get(this.state);
                default:
                    throw new Error(`Invalid resolver strategy specified: ${this.strategy}.`);
            }
        }
        getFactory(container) {
            var _a, _b, _c;
            switch (this.strategy) {
                case 1 /* singleton */:
                case 2 /* transient */:
                    return container.getFactory(this.state);
                case 5 /* alias */:
                    return (_c = (_b = (_a = container.getResolver(this.state)) === null || _a === void 0 ? void 0 : _a.getFactory) === null || _b === void 0 ? void 0 : _b.call(_a, container)) !== null && _c !== void 0 ? _c : null;
                default:
                    return null;
            }
        }
    }
    function containerGetKey(d) {
        return this.get(d);
    }
    function transformInstance(inst, transform) {
        return transform(inst);
    }
    /** @internal */
    class FactoryImpl {
        constructor(Type, dependencies) {
            this.Type = Type;
            this.dependencies = dependencies;
            this.transformers = null;
        }
        construct(container, dynamicDependencies) {
            let instance;
            if (dynamicDependencies === void 0) {
                instance = new this.Type(...this.dependencies.map(containerGetKey, container));
            }
            else {
                instance = new this.Type(...this.dependencies.map(containerGetKey, container), ...dynamicDependencies);
            }
            if (this.transformers == null) {
                return instance;
            }
            return this.transformers.reduce(transformInstance, instance);
        }
        registerTransformer(transformer) {
            (this.transformers || (this.transformers = [])).push(transformer);
        }
    }
    const containerResolver = {
        $isResolver: true,
        resolve(handler, requestor) {
            return requestor;
        },
    };
    function isRegistry(obj) {
        return typeof obj.register === "function";
    }
    function isSelfRegistry(obj) {
        return isRegistry(obj) && typeof obj.registerInRequestor === "boolean";
    }
    function isRegisterInRequester(obj) {
        return isSelfRegistry(obj) && obj.registerInRequestor;
    }
    function isClass(obj) {
        return obj.prototype !== void 0;
    }
    const InstrinsicTypeNames = new Set([
        "Array",
        "ArrayBuffer",
        "Boolean",
        "DataView",
        "Date",
        "Error",
        "EvalError",
        "Float32Array",
        "Float64Array",
        "Function",
        "Int8Array",
        "Int16Array",
        "Int32Array",
        "Map",
        "Number",
        "Object",
        "Promise",
        "RangeError",
        "ReferenceError",
        "RegExp",
        "Set",
        "SharedArrayBuffer",
        "String",
        "SyntaxError",
        "TypeError",
        "Uint8Array",
        "Uint8ClampedArray",
        "Uint16Array",
        "Uint32Array",
        "URIError",
        "WeakMap",
        "WeakSet",
    ]);
    const DILocateParentEventType = "__DI_LOCATE_PARENT__";
    const factories = new Map();
    /**
     * @internal
     */
    class ContainerImpl {
        constructor(owner, config) {
            this.owner = owner;
            this.config = config;
            this._parent = void 0;
            this.registerDepth = 0;
            this.context = null;
            if (owner !== null) {
                owner.$$container$$ = this;
            }
            this.resolvers = new Map();
            this.resolvers.set(Container, containerResolver);
            if (owner instanceof Node) {
                owner.addEventListener(DILocateParentEventType, (e) => {
                    if (e.composedPath()[0] !== this.owner) {
                        e.detail.container = this;
                        e.stopImmediatePropagation();
                    }
                });
            }
        }
        get parent() {
            if (this._parent === void 0) {
                this._parent = this.config.parentLocator(this.owner);
            }
            return this._parent;
        }
        get depth() {
            return this.parent === null ? 0 : this.parent.depth + 1;
        }
        get responsibleForOwnerRequests() {
            return this.config.responsibleForOwnerRequests;
        }
        registerWithContext(context, ...params) {
            this.context = context;
            this.register(...params);
            this.context = null;
            return this;
        }
        register(...params) {
            if (++this.registerDepth === 100) {
                throw new Error("Unable to autoregister dependency");
                // Most likely cause is trying to register a plain object that does not have a
                // register method and is not a class constructor
            }
            let current;
            let keys;
            let value;
            let j;
            let jj;
            const context = this.context;
            for (let i = 0, ii = params.length; i < ii; ++i) {
                current = params[i];
                if (!isObject(current)) {
                    continue;
                }
                if (isRegistry(current)) {
                    current.register(this, context);
                }
                else if (isClass(current)) {
                    Registration.singleton(current, current).register(this);
                }
                else {
                    keys = Object.keys(current);
                    j = 0;
                    jj = keys.length;
                    for (; j < jj; ++j) {
                        value = current[keys[j]];
                        if (!isObject(value)) {
                            continue;
                        }
                        // note: we could remove this if-branch and call this.register directly
                        // - the extra check is just a perf tweak to create fewer unnecessary arrays by the spread operator
                        if (isRegistry(value)) {
                            value.register(this, context);
                        }
                        else {
                            this.register(value);
                        }
                    }
                }
            }
            --this.registerDepth;
            return this;
        }
        registerResolver(key, resolver) {
            validateKey(key);
            const resolvers = this.resolvers;
            const result = resolvers.get(key);
            if (result == null) {
                resolvers.set(key, resolver);
            }
            else if (result instanceof ResolverImpl &&
                result.strategy === 4 /* array */) {
                result.state.push(resolver);
            }
            else {
                resolvers.set(key, new ResolverImpl(key, 4 /* array */, [result, resolver]));
            }
            return resolver;
        }
        registerTransformer(key, transformer) {
            const resolver = this.getResolver(key);
            if (resolver == null) {
                return false;
            }
            if (resolver.getFactory) {
                const factory = resolver.getFactory(this);
                if (factory == null) {
                    return false;
                }
                // This type cast is a bit of a hacky one, necessary due to the duplicity of IResolverLike.
                // Problem is that that interface's type arg can be of type Key, but the getFactory method only works on
                // type Constructable. So the return type of that optional method has this additional constraint, which
                // seems to confuse the type checker.
                factory.registerTransformer(transformer);
                return true;
            }
            return false;
        }
        getResolver(key, autoRegister = true) {
            validateKey(key);
            if (key.resolve !== void 0) {
                return key;
            }
            /* eslint-disable-next-line @typescript-eslint/no-this-alias */
            let current = this;
            let resolver;
            while (current != null) {
                resolver = current.resolvers.get(key);
                if (resolver == null) {
                    if (current.parent == null) {
                        const handler = isRegisterInRequester(key)
                            ? this
                            : current;
                        return autoRegister ? this.jitRegister(key, handler) : null;
                    }
                    current = current.parent;
                }
                else {
                    return resolver;
                }
            }
            return null;
        }
        has(key, searchAncestors = false) {
            return this.resolvers.has(key)
                ? true
                : searchAncestors && this.parent != null
                    ? this.parent.has(key, true)
                    : false;
        }
        get(key) {
            validateKey(key);
            if (key.$isResolver) {
                return key.resolve(this, this);
            }
            /* eslint-disable-next-line @typescript-eslint/no-this-alias */
            let current = this;
            let resolver;
            while (current != null) {
                resolver = current.resolvers.get(key);
                if (resolver == null) {
                    if (current.parent == null) {
                        const handler = isRegisterInRequester(key)
                            ? this
                            : current;
                        resolver = this.jitRegister(key, handler);
                        return resolver.resolve(current, this);
                    }
                    current = current.parent;
                }
                else {
                    return resolver.resolve(current, this);
                }
            }
            throw new Error(`Unable to resolve key: ${key}`);
        }
        getAll(key, searchAncestors = false) {
            validateKey(key);
            /* eslint-disable-next-line @typescript-eslint/no-this-alias */
            const requestor = this;
            let current = requestor;
            let resolver;
            if (searchAncestors) {
                let resolutions = emptyArray;
                while (current != null) {
                    resolver = current.resolvers.get(key);
                    if (resolver != null) {
                        resolutions = resolutions.concat(
                        /* eslint-disable-next-line @typescript-eslint/no-non-null-assertion */
                        buildAllResponse(resolver, current, requestor));
                    }
                    current = current.parent;
                }
                return resolutions;
            }
            else {
                while (current != null) {
                    resolver = current.resolvers.get(key);
                    if (resolver == null) {
                        current = current.parent;
                        if (current == null) {
                            return emptyArray;
                        }
                    }
                    else {
                        return buildAllResponse(resolver, current, requestor);
                    }
                }
            }
            return emptyArray;
        }
        getFactory(Type) {
            let factory = factories.get(Type);
            if (factory === void 0) {
                if (isNativeFunction(Type)) {
                    throw new Error(`${Type.name} is a native function and therefore cannot be safely constructed by DI. If this is intentional, please use a callback or cachedCallback resolver.`);
                }
                factories.set(Type, (factory = new FactoryImpl(Type, DI.getDependencies(Type))));
            }
            return factory;
        }
        registerFactory(key, factory) {
            factories.set(key, factory);
        }
        createChild(config) {
            return new ContainerImpl(null, Object.assign({}, this.config, config, { parentLocator: () => this }));
        }
        jitRegister(keyAsValue, handler) {
            if (typeof keyAsValue !== "function") {
                throw new Error(`Attempted to jitRegister something that is not a constructor: '${keyAsValue}'. Did you forget to register this dependency?`);
            }
            if (InstrinsicTypeNames.has(keyAsValue.name)) {
                throw new Error(`Attempted to jitRegister an intrinsic type: ${keyAsValue.name}. Did you forget to add @inject(Key)`);
            }
            if (isRegistry(keyAsValue)) {
                const registrationResolver = keyAsValue.register(handler);
                if (!(registrationResolver instanceof Object) ||
                    registrationResolver.resolve == null) {
                    const newResolver = handler.resolvers.get(keyAsValue);
                    if (newResolver != void 0) {
                        return newResolver;
                    }
                    throw new Error("A valid resolver was not returned from the static register method");
                }
                return registrationResolver;
            }
            else if (keyAsValue.$isInterface) {
                throw new Error(`Attempted to jitRegister an interface: ${keyAsValue.friendlyName}`);
            }
            else {
                const resolver = this.config.defaultResolver(keyAsValue, handler);
                handler.resolvers.set(keyAsValue, resolver);
                return resolver;
            }
        }
    }
    const cache = new WeakMap();
    function cacheCallbackResult(fun) {
        return function (handler, requestor, resolver) {
            if (cache.has(resolver)) {
                return cache.get(resolver);
            }
            const t = fun(handler, requestor, resolver);
            cache.set(resolver, t);
            return t;
        };
    }
    /**
     * You can use the resulting Registration of any of the factory methods
     * to register with the container.
     *
     * @example
     * ```
     * class Foo {}
     * const container = DI.createContainer();
     * container.register(Registration.instance(Foo, new Foo()));
     * container.get(Foo);
     * ```
     *
     * @public
     */
    const Registration = Object.freeze({
        /**
         * Allows you to pass an instance.
         * Every time you request this {@link Key} you will get this instance back.
         *
         * @example
         * ```
         * Registration.instance(Foo, new Foo()));
         * ```
         *
         * @param key - The key to register the instance under.
         * @param value - The instance to return when the key is requested.
         */
        instance(key, value) {
            return new ResolverImpl(key, 0 /* instance */, value);
        },
        /**
         * Creates an instance from the class.
         * Every time you request this {@link Key} you will get the same one back.
         *
         * @example
         * ```
         * Registration.singleton(Foo, Foo);
         * ```
         *
         * @param key - The key to register the singleton under.
         * @param value - The class to instantiate as a singleton when first requested.
         */
        singleton(key, value) {
            return new ResolverImpl(key, 1 /* singleton */, value);
        },
        /**
         * Creates an instance from a class.
         * Every time you request this {@link Key} you will get a new instance.
         *
         * @example
         * ```
         * Registration.instance(Foo, Foo);
         * ```
         *
         * @param key - The key to register the instance type under.
         * @param value - The class to instantiate each time the key is requested.
         */
        transient(key, value) {
            return new ResolverImpl(key, 2 /* transient */, value);
        },
        /**
         * Delegates to a callback function to provide the dependency.
         * Every time you request this {@link Key} the callback will be invoked to provide
         * the dependency.
         *
         * @example
         * ```
         * Registration.callback(Foo, () => new Foo());
         * Registration.callback(Bar, (c: Container) => new Bar(c.get(Foo)));
         * ```
         *
         * @param key - The key to register the callback for.
         * @param callback - The function that is expected to return the dependency.
         */
        callback(key, callback) {
            return new ResolverImpl(key, 3 /* callback */, callback);
        },
        /**
         * Delegates to a callback function to provide the dependency and then caches the
         * dependency for future requests.
         *
         * @example
         * ```
         * Registration.cachedCallback(Foo, () => new Foo());
         * Registration.cachedCallback(Bar, (c: Container) => new Bar(c.get(Foo)));
         * ```
         *
         * @param key - The key to register the callback for.
         * @param callback - The function that is expected to return the dependency.
         * @remarks
         * If you pass the same Registration to another container, the same cached value will be used.
         * Should all references to the resolver returned be removed, the cache will expire.
         */
        cachedCallback(key, callback) {
            return new ResolverImpl(key, 3 /* callback */, cacheCallbackResult(callback));
        },
        /**
         * Creates an alternate {@link Key} to retrieve an instance by.
         *
         * @example
         * ```
         * Register.singleton(Foo, Foo)
         * Register.aliasTo(Foo, MyFoos);
         *
         * container.getAll(MyFoos) // contains an instance of Foo
         * ```
         *
         * @param originalKey - The original key that has been registered.
         * @param aliasKey - The alias to the original key.
         */
        aliasTo(originalKey, aliasKey) {
            return new ResolverImpl(aliasKey, 5 /* alias */, originalKey);
        },
    });
    /** @internal */
    function validateKey(key) {
        if (key === null || key === void 0) {
            throw new Error("key/value cannot be null or undefined. Are you trying to inject/register something that doesn't exist with DI?");
        }
    }
    function buildAllResponse(resolver, handler, requestor) {
        if (resolver instanceof ResolverImpl &&
            resolver.strategy === 4 /* array */) {
            const state = resolver.state;
            let i = state.length;
            const results = new Array(i);
            while (i--) {
                results[i] = state[i].resolve(handler, requestor);
            }
            return results;
        }
        return [resolver.resolve(handler, requestor)];
    }
    const defaultFriendlyName = "(anonymous)";
    function isObject(value) {
        return (typeof value === "object" && value !== null) || typeof value === "function";
    }
    /**
     * Determine whether the value is a native function.
     *
     * @param fn - The function to check.
     * @returns `true` is the function is a native function, otherwise `false`
     */
    const isNativeFunction = (function () {
        const lookup = new WeakMap();
        let isNative = false;
        let sourceText = "";
        let i = 0;
        return function (fn) {
            isNative = lookup.get(fn);
            if (isNative === void 0) {
                sourceText = fn.toString();
                i = sourceText.length;
                // http://www.ecma-international.org/ecma-262/#prod-NativeFunction
                isNative =
                    // 29 is the length of 'function () { [native code] }' which is the smallest length of a native function string
                    i >= 29 &&
                        // 100 seems to be a safe upper bound of the max length of a native function. In Chrome and FF it's 56, in Edge it's 61.
                        i <= 100 &&
                        // This whole heuristic *could* be tricked by a comment. Do we need to care about that?
                        sourceText.charCodeAt(i - 1) === 0x7d && // }
                        // TODO: the spec is a little vague about the precise constraints, so we do need to test this across various browsers to make sure just one whitespace is a safe assumption.
                        sourceText.charCodeAt(i - 2) <= 0x20 && // whitespace
                        sourceText.charCodeAt(i - 3) === 0x5d && // ]
                        sourceText.charCodeAt(i - 4) === 0x65 && // e
                        sourceText.charCodeAt(i - 5) === 0x64 && // d
                        sourceText.charCodeAt(i - 6) === 0x6f && // o
                        sourceText.charCodeAt(i - 7) === 0x63 && // c
                        sourceText.charCodeAt(i - 8) === 0x20 && //
                        sourceText.charCodeAt(i - 9) === 0x65 && // e
                        sourceText.charCodeAt(i - 10) === 0x76 && // v
                        sourceText.charCodeAt(i - 11) === 0x69 && // i
                        sourceText.charCodeAt(i - 12) === 0x74 && // t
                        sourceText.charCodeAt(i - 13) === 0x61 && // a
                        sourceText.charCodeAt(i - 14) === 0x6e && // n
                        sourceText.charCodeAt(i - 15) === 0x58; // [
                lookup.set(fn, isNative);
            }
            return isNative;
        };
    })();
    const isNumericLookup = {};
    function isArrayIndex(value) {
        switch (typeof value) {
            case "number":
                return value >= 0 && (value | 0) === value;
            case "string": {
                const result = isNumericLookup[value];
                if (result !== void 0) {
                    return result;
                }
                const length = value.length;
                if (length === 0) {
                    return (isNumericLookup[value] = false);
                }
                let ch = 0;
                for (let i = 0; i < length; ++i) {
                    ch = value.charCodeAt(i);
                    if ((i === 0 && ch === 0x30 && length > 1) /* must not start with 0 */ ||
                        ch < 0x30 /* 0 */ ||
                        ch > 0x39 /* 9 */) {
                        return (isNumericLookup[value] = false);
                    }
                }
                return (isNumericLookup[value] = true);
            }
            default:
                return false;
        }
    }

    function presentationKeyFromTag(tagName) {
        return `${tagName.toLowerCase()}:presentation`;
    }
    const presentationRegistry = new Map();
    /**
     * An API gateway to component presentation features.
     * @public
     */
    const ComponentPresentation = Object.freeze({
        /**
         * Defines a component presentation for an element.
         * @param tagName - The element name to define the presentation for.
         * @param presentation - The presentation that will be applied to matching elements.
         * @param container - The dependency injection container to register the configuration in.
         * @public
         */
        define(tagName, presentation, container) {
            const key = presentationKeyFromTag(tagName);
            const existing = presentationRegistry.get(key);
            if (existing === void 0) {
                presentationRegistry.set(key, presentation);
            }
            else {
                // false indicates that we have more than one presentation
                // registered for a tagName and we must resolve through DI
                presentationRegistry.set(key, false);
            }
            container.register(Registration.instance(key, presentation));
        },
        /**
         * Finds a component presentation for the specified element name,
         * searching the DOM hierarchy starting from the provided element.
         * @param tagName - The name of the element to locate the presentation for.
         * @param element - The element to begin the search from.
         * @returns The component presentation or null if none is found.
         * @public
         */
        forTag(tagName, element) {
            const key = presentationKeyFromTag(tagName);
            const existing = presentationRegistry.get(key);
            if (existing === false) {
                const container = DI.findResponsibleContainer(element);
                return container.get(key);
            }
            return existing || null;
        },
    });
    /**
     * The default implementation of ComponentPresentation, used by FoundationElement.
     * @public
     */
    class DefaultComponentPresentation {
        /**
         * Creates an instance of DefaultComponentPresentation.
         * @param template - The template to apply to the element.
         * @param styles - The styles to apply to the element.
         * @public
         */
        constructor(template, styles) {
            this.template = template || null;
            this.styles =
                styles === void 0
                    ? null
                    : Array.isArray(styles)
                        ? ElementStyles.create(styles)
                        : styles instanceof ElementStyles
                            ? styles
                            : ElementStyles.create([styles]);
        }
        /**
         * Applies the presentation details to the specified element.
         * @param element - The element to apply the presentation details to.
         * @public
         */
        applyTo(element) {
            const controller = element.$fastController;
            if (controller.template === null) {
                controller.template = this.template;
            }
            if (controller.styles === null) {
                controller.styles = this.styles;
            }
        }
    }

    /**
     * Defines a foundation element class that:
     * 1. Connects the element to its ComponentPresentation
     * 2. Allows resolving the element template from the instance or ComponentPresentation
     * 3. Allows resolving the element styles from the instance or ComponentPresentation
     *
     * @public
     */
    class FoundationElement extends FASTElement {
        constructor() {
            super(...arguments);
            this._presentation = void 0;
        }
        /**
         * A property which resolves the ComponentPresentation instance
         * for the current component.
         * @public
         */
        get $presentation() {
            if (this._presentation === void 0) {
                this._presentation = ComponentPresentation.forTag(this.tagName, this);
            }
            return this._presentation;
        }
        templateChanged() {
            if (this.template !== undefined) {
                this.$fastController.template = this.template;
            }
        }
        stylesChanged() {
            if (this.styles !== undefined) {
                this.$fastController.styles = this.styles;
            }
        }
        /**
         * The connected callback for this FASTElement.
         * @remarks
         * This method is invoked by the platform whenever this FoundationElement
         * becomes connected to the document.
         * @public
         */
        connectedCallback() {
            if (this.$presentation !== null) {
                this.$presentation.applyTo(this);
            }
            super.connectedCallback();
        }
        /**
         * Defines an element registry function with a set of element definition defaults.
         * @param elementDefinition - The definition of the element to create the registry
         * function for.
         * @public
         */
        static compose(elementDefinition) {
            return (overrideDefinition = {}) => new FoundationElementRegistry(this === FoundationElement
                ? class extends FoundationElement {
                }
                : this, elementDefinition, overrideDefinition);
        }
    }
    __decorate$1([
        observable
    ], FoundationElement.prototype, "template", void 0);
    __decorate$1([
        observable
    ], FoundationElement.prototype, "styles", void 0);
    function resolveOption(option, context, definition) {
        if (typeof option === "function") {
            return option(context, definition);
        }
        return option;
    }
    /**
     * Registry capable of defining presentation properties for a DOM Container hierarchy.
     *
     * @internal
     */
    /* eslint-disable @typescript-eslint/no-unused-vars */
    class FoundationElementRegistry {
        constructor(type, elementDefinition, overrideDefinition) {
            this.type = type;
            this.elementDefinition = elementDefinition;
            this.overrideDefinition = overrideDefinition;
            this.definition = Object.assign(Object.assign({}, this.elementDefinition), this.overrideDefinition);
        }
        register(container, context) {
            const definition = this.definition;
            const overrideDefinition = this.overrideDefinition;
            const prefix = definition.prefix || context.elementPrefix;
            const name = `${prefix}-${definition.baseName}`;
            context.tryDefineElement({
                name,
                type: this.type,
                baseClass: this.elementDefinition.baseClass,
                callback: x => {
                    const presentation = new DefaultComponentPresentation(resolveOption(definition.template, x, definition), resolveOption(definition.styles, x, definition));
                    x.definePresentation(presentation);
                    let shadowOptions = resolveOption(definition.shadowOptions, x, definition);
                    if (x.shadowRootMode) {
                        // If the design system has overridden the shadow root mode, we need special handling.
                        if (shadowOptions) {
                            // If there are shadow options present in the definition, then
                            // either the component itself has specified an option or the
                            // registry function has overridden it.
                            if (!overrideDefinition.shadowOptions) {
                                // There were shadow options provided by the component and not overridden by
                                // the registry.
                                shadowOptions.mode = x.shadowRootMode;
                            }
                        }
                        else if (shadowOptions !== null) {
                            // If the component author did not provide shadow options,
                            // and did not null them out (light dom opt-in) then they
                            // were relying on the FASTElement default. So, if the
                            // design system provides a mode, we need to create the options
                            // to override the default.
                            shadowOptions = { mode: x.shadowRootMode };
                        }
                    }
                    x.defineElement({
                        elementOptions: resolveOption(definition.elementOptions, x, definition),
                        shadowOptions,
                        attributes: resolveOption(definition.attributes, x, definition),
                    });
                },
            });
        }
    }
    /* eslint-enable @typescript-eslint/no-unused-vars */

    /**
     * Apply mixins to a constructor.
     * Sourced from {@link https://www.typescriptlang.org/docs/handbook/mixins.html | TypeScript Documentation }.
     * @public
     */
    function applyMixins(derivedCtor, ...baseCtors) {
        baseCtors.forEach(baseCtor => {
            Object.getOwnPropertyNames(baseCtor.prototype).forEach(name => {
                if (name !== "constructor") {
                    Object.defineProperty(derivedCtor.prototype, name, 
                    /* eslint-disable-next-line @typescript-eslint/no-non-null-assertion */
                    Object.getOwnPropertyDescriptor(baseCtor.prototype, name));
                }
            });
            if (baseCtor.attributes) {
                const existing = derivedCtor.attributes || [];
                derivedCtor.attributes = existing.concat(baseCtor.attributes);
            }
        });
    }

    /**
     * Returns the index of the last element in the array where predicate is true, and -1 otherwise.
     *
     * @param array - the array to test
     * @param predicate - find calls predicate once for each element of the array, in descending order, until it finds one where predicate returns true. If such an element is found, findLastIndex immediately returns that element index. Otherwise, findIndex returns -1.
     */
    function findLastIndex(array, predicate) {
        let k = array.length;
        while (k--) {
            if (predicate(array[k], k, array)) {
                return k;
            }
        }
        return -1;
    }

    /**
     * Checks if the DOM is available to access and use
     */
    function canUseDOM() {
        return !!(typeof window !== "undefined" && window.document && window.document.createElement);
    }

    /**
     * A test that ensures that all arguments are HTML Elements
     */
    function isHTMLElement(...args) {
        return args.every((arg) => arg instanceof HTMLElement);
    }
    /**
     * Returns all displayed elements inside of a root node that match a provided selector
     */
    function getDisplayedNodes(rootNode, selector) {
        if (!rootNode || !selector || !isHTMLElement(rootNode)) {
            return;
        }
        const nodes = Array.from(rootNode.querySelectorAll(selector));
        // offsetParent will be null if the element isn't currently displayed,
        // so this will allow us to operate only on visible nodes
        return nodes.filter((node) => node.offsetParent !== null);
    }
    /**
     * Returns the nonce used in the page, if any.
     *
     * Based on https://github.com/cssinjs/jss/blob/master/packages/jss/src/DomRenderer.js
     */
    function getNonce() {
        const node = document.querySelector('meta[property="csp-nonce"]');
        if (node) {
            return node.getAttribute("content");
        }
        else {
            return null;
        }
    }
    /**
     * Test if the document supports :focus-visible
     */
    let _canUseFocusVisible;
    function canUseFocusVisible() {
        if (typeof _canUseFocusVisible === "boolean") {
            return _canUseFocusVisible;
        }
        if (!canUseDOM()) {
            _canUseFocusVisible = false;
            return _canUseFocusVisible;
        }
        // Check to see if the document supports the focus-visible element
        const styleElement = document.createElement("style");
        // If nonces are present on the page, use it when creating the style element
        // to test focus-visible support.
        const styleNonce = getNonce();
        if (styleNonce !== null) {
            styleElement.setAttribute("nonce", styleNonce);
        }
        document.head.appendChild(styleElement);
        try {
            styleElement.sheet.insertRule("foo:focus-visible {color:inherit}", 0);
            _canUseFocusVisible = true;
        }
        catch (e) {
            _canUseFocusVisible = false;
        }
        finally {
            document.head.removeChild(styleElement);
        }
        return _canUseFocusVisible;
    }

    /**
     * This set of exported strings reference https://developer.mozilla.org/en-US/docs/Web/Events
     * and should include all non-deprecated and non-experimental Standard events
     */
    const eventResize = "resize";
    const eventScroll = "scroll";

    /**
     * Key Code values
     * @deprecated - KeyCodes are deprecated, use individual string key exports
     */
    var KeyCodes;
    (function (KeyCodes) {
        KeyCodes[KeyCodes["alt"] = 18] = "alt";
        KeyCodes[KeyCodes["arrowDown"] = 40] = "arrowDown";
        KeyCodes[KeyCodes["arrowLeft"] = 37] = "arrowLeft";
        KeyCodes[KeyCodes["arrowRight"] = 39] = "arrowRight";
        KeyCodes[KeyCodes["arrowUp"] = 38] = "arrowUp";
        KeyCodes[KeyCodes["back"] = 8] = "back";
        KeyCodes[KeyCodes["backSlash"] = 220] = "backSlash";
        KeyCodes[KeyCodes["break"] = 19] = "break";
        KeyCodes[KeyCodes["capsLock"] = 20] = "capsLock";
        KeyCodes[KeyCodes["closeBracket"] = 221] = "closeBracket";
        KeyCodes[KeyCodes["colon"] = 186] = "colon";
        KeyCodes[KeyCodes["colon2"] = 59] = "colon2";
        KeyCodes[KeyCodes["comma"] = 188] = "comma";
        KeyCodes[KeyCodes["ctrl"] = 17] = "ctrl";
        KeyCodes[KeyCodes["delete"] = 46] = "delete";
        KeyCodes[KeyCodes["end"] = 35] = "end";
        KeyCodes[KeyCodes["enter"] = 13] = "enter";
        KeyCodes[KeyCodes["equals"] = 187] = "equals";
        KeyCodes[KeyCodes["equals2"] = 61] = "equals2";
        KeyCodes[KeyCodes["equals3"] = 107] = "equals3";
        KeyCodes[KeyCodes["escape"] = 27] = "escape";
        KeyCodes[KeyCodes["forwardSlash"] = 191] = "forwardSlash";
        KeyCodes[KeyCodes["function1"] = 112] = "function1";
        KeyCodes[KeyCodes["function10"] = 121] = "function10";
        KeyCodes[KeyCodes["function11"] = 122] = "function11";
        KeyCodes[KeyCodes["function12"] = 123] = "function12";
        KeyCodes[KeyCodes["function2"] = 113] = "function2";
        KeyCodes[KeyCodes["function3"] = 114] = "function3";
        KeyCodes[KeyCodes["function4"] = 115] = "function4";
        KeyCodes[KeyCodes["function5"] = 116] = "function5";
        KeyCodes[KeyCodes["function6"] = 117] = "function6";
        KeyCodes[KeyCodes["function7"] = 118] = "function7";
        KeyCodes[KeyCodes["function8"] = 119] = "function8";
        KeyCodes[KeyCodes["function9"] = 120] = "function9";
        KeyCodes[KeyCodes["home"] = 36] = "home";
        KeyCodes[KeyCodes["insert"] = 45] = "insert";
        KeyCodes[KeyCodes["menu"] = 93] = "menu";
        KeyCodes[KeyCodes["minus"] = 189] = "minus";
        KeyCodes[KeyCodes["minus2"] = 109] = "minus2";
        KeyCodes[KeyCodes["numLock"] = 144] = "numLock";
        KeyCodes[KeyCodes["numPad0"] = 96] = "numPad0";
        KeyCodes[KeyCodes["numPad1"] = 97] = "numPad1";
        KeyCodes[KeyCodes["numPad2"] = 98] = "numPad2";
        KeyCodes[KeyCodes["numPad3"] = 99] = "numPad3";
        KeyCodes[KeyCodes["numPad4"] = 100] = "numPad4";
        KeyCodes[KeyCodes["numPad5"] = 101] = "numPad5";
        KeyCodes[KeyCodes["numPad6"] = 102] = "numPad6";
        KeyCodes[KeyCodes["numPad7"] = 103] = "numPad7";
        KeyCodes[KeyCodes["numPad8"] = 104] = "numPad8";
        KeyCodes[KeyCodes["numPad9"] = 105] = "numPad9";
        KeyCodes[KeyCodes["numPadDivide"] = 111] = "numPadDivide";
        KeyCodes[KeyCodes["numPadDot"] = 110] = "numPadDot";
        KeyCodes[KeyCodes["numPadMinus"] = 109] = "numPadMinus";
        KeyCodes[KeyCodes["numPadMultiply"] = 106] = "numPadMultiply";
        KeyCodes[KeyCodes["numPadPlus"] = 107] = "numPadPlus";
        KeyCodes[KeyCodes["openBracket"] = 219] = "openBracket";
        KeyCodes[KeyCodes["pageDown"] = 34] = "pageDown";
        KeyCodes[KeyCodes["pageUp"] = 33] = "pageUp";
        KeyCodes[KeyCodes["period"] = 190] = "period";
        KeyCodes[KeyCodes["print"] = 44] = "print";
        KeyCodes[KeyCodes["quote"] = 222] = "quote";
        KeyCodes[KeyCodes["scrollLock"] = 145] = "scrollLock";
        KeyCodes[KeyCodes["shift"] = 16] = "shift";
        KeyCodes[KeyCodes["space"] = 32] = "space";
        KeyCodes[KeyCodes["tab"] = 9] = "tab";
        KeyCodes[KeyCodes["tilde"] = 192] = "tilde";
        KeyCodes[KeyCodes["windowsLeft"] = 91] = "windowsLeft";
        KeyCodes[KeyCodes["windowsOpera"] = 219] = "windowsOpera";
        KeyCodes[KeyCodes["windowsRight"] = 92] = "windowsRight";
    })(KeyCodes || (KeyCodes = {}));
    /**
     * String values for use with KeyboardEvent.key
     */
    const keyArrowDown = "ArrowDown";
    const keyArrowLeft = "ArrowLeft";
    const keyArrowRight = "ArrowRight";
    const keyArrowUp = "ArrowUp";
    const keyEnter = "Enter";
    const keyEscape = "Escape";
    const keyHome = "Home";
    const keyEnd = "End";
    const keySpace = " ";
    const keyTab = "Tab";

    /**
     * Expose ltr and rtl strings
     */
    var Direction;
    (function (Direction) {
        Direction["ltr"] = "ltr";
        Direction["rtl"] = "rtl";
    })(Direction || (Direction = {}));

    /**
     * This method keeps a given value within the bounds of a min and max value. If the value
     * is larger than the max, the minimum value will be returned. If the value is smaller than the minimum,
     * the maximum will be returned. Otherwise, the value is returned un-changed.
     */
    function wrapInBounds(min, max, value) {
        if (value < min) {
            return max;
        }
        else if (value > max) {
            return min;
        }
        return value;
    }

    let uniqueIdCounter = 0;
    /**
     * Generates a unique ID based on incrementing a counter.
     */
    function uniqueId(prefix = "") {
        return `${prefix}${uniqueIdCounter++}`;
    }

    /**
     * The template for the {@link @microsoft/fast-foundation#(Anchor:class)} component.
     * @public
     */
    const anchorTemplate = (context, definition) => html `
    <a
        class="control"
        part="control"
        download="${x => x.download}"
        href="${x => x.href}"
        hreflang="${x => x.hreflang}"
        ping="${x => x.ping}"
        referrerpolicy="${x => x.referrerpolicy}"
        rel="${x => x.rel}"
        target="${x => x.target}"
        type="${x => x.type}"
        aria-atomic="${x => x.ariaAtomic}"
        aria-busy="${x => x.ariaBusy}"
        aria-controls="${x => x.ariaControls}"
        aria-current="${x => x.ariaCurrent}"
        aria-describedby="${x => x.ariaDescribedby}"
        aria-details="${x => x.ariaDetails}"
        aria-disabled="${x => x.ariaDisabled}"
        aria-errormessage="${x => x.ariaErrormessage}"
        aria-expanded="${x => x.ariaExpanded}"
        aria-flowto="${x => x.ariaFlowto}"
        aria-haspopup="${x => x.ariaHaspopup}"
        aria-hidden="${x => x.ariaHidden}"
        aria-invalid="${x => x.ariaInvalid}"
        aria-keyshortcuts="${x => x.ariaKeyshortcuts}"
        aria-label="${x => x.ariaLabel}"
        aria-labelledby="${x => x.ariaLabelledby}"
        aria-live="${x => x.ariaLive}"
        aria-owns="${x => x.ariaOwns}"
        aria-relevant="${x => x.ariaRelevant}"
        aria-roledescription="${x => x.ariaRoledescription}"
        ${ref("control")}
    >
        ${startSlotTemplate(context, definition)}
        <span class="content" part="content">
            <slot ${slotted("defaultSlottedContent")}></slot>
        </span>
        ${endSlotTemplate(context, definition)}
    </a>
`;

    /**
     * Some states and properties are applicable to all host language elements regardless of whether a role is applied.
     * The following global states and properties are supported by all roles and by all base markup elements.
     * {@link https://www.w3.org/TR/wai-aria-1.1/#global_states}
     *
     * This is intended to be used as a mixin. Be sure you extend FASTElement.
     *
     * @public
     */
    class ARIAGlobalStatesAndProperties {
    }
    __decorate$1([
        attr({ attribute: "aria-atomic", mode: "fromView" })
    ], ARIAGlobalStatesAndProperties.prototype, "ariaAtomic", void 0);
    __decorate$1([
        attr({ attribute: "aria-busy", mode: "fromView" })
    ], ARIAGlobalStatesAndProperties.prototype, "ariaBusy", void 0);
    __decorate$1([
        attr({ attribute: "aria-controls", mode: "fromView" })
    ], ARIAGlobalStatesAndProperties.prototype, "ariaControls", void 0);
    __decorate$1([
        attr({ attribute: "aria-current", mode: "fromView" })
    ], ARIAGlobalStatesAndProperties.prototype, "ariaCurrent", void 0);
    __decorate$1([
        attr({ attribute: "aria-describedby", mode: "fromView" })
    ], ARIAGlobalStatesAndProperties.prototype, "ariaDescribedby", void 0);
    __decorate$1([
        attr({ attribute: "aria-details", mode: "fromView" })
    ], ARIAGlobalStatesAndProperties.prototype, "ariaDetails", void 0);
    __decorate$1([
        attr({ attribute: "aria-disabled", mode: "fromView" })
    ], ARIAGlobalStatesAndProperties.prototype, "ariaDisabled", void 0);
    __decorate$1([
        attr({ attribute: "aria-errormessage", mode: "fromView" })
    ], ARIAGlobalStatesAndProperties.prototype, "ariaErrormessage", void 0);
    __decorate$1([
        attr({ attribute: "aria-flowto", mode: "fromView" })
    ], ARIAGlobalStatesAndProperties.prototype, "ariaFlowto", void 0);
    __decorate$1([
        attr({ attribute: "aria-haspopup", mode: "fromView" })
    ], ARIAGlobalStatesAndProperties.prototype, "ariaHaspopup", void 0);
    __decorate$1([
        attr({ attribute: "aria-hidden", mode: "fromView" })
    ], ARIAGlobalStatesAndProperties.prototype, "ariaHidden", void 0);
    __decorate$1([
        attr({ attribute: "aria-invalid", mode: "fromView" })
    ], ARIAGlobalStatesAndProperties.prototype, "ariaInvalid", void 0);
    __decorate$1([
        attr({ attribute: "aria-keyshortcuts", mode: "fromView" })
    ], ARIAGlobalStatesAndProperties.prototype, "ariaKeyshortcuts", void 0);
    __decorate$1([
        attr({ attribute: "aria-label", mode: "fromView" })
    ], ARIAGlobalStatesAndProperties.prototype, "ariaLabel", void 0);
    __decorate$1([
        attr({ attribute: "aria-labelledby", mode: "fromView" })
    ], ARIAGlobalStatesAndProperties.prototype, "ariaLabelledby", void 0);
    __decorate$1([
        attr({ attribute: "aria-live", mode: "fromView" })
    ], ARIAGlobalStatesAndProperties.prototype, "ariaLive", void 0);
    __decorate$1([
        attr({ attribute: "aria-owns", mode: "fromView" })
    ], ARIAGlobalStatesAndProperties.prototype, "ariaOwns", void 0);
    __decorate$1([
        attr({ attribute: "aria-relevant", mode: "fromView" })
    ], ARIAGlobalStatesAndProperties.prototype, "ariaRelevant", void 0);
    __decorate$1([
        attr({ attribute: "aria-roledescription", mode: "fromView" })
    ], ARIAGlobalStatesAndProperties.prototype, "ariaRoledescription", void 0);

    /**
     * An Anchor Custom HTML Element.
     * Based largely on the {@link https://developer.mozilla.org/en-US/docs/Web/HTML/Element/a | <a> element }.
     *
     * @public
     */
    class Anchor extends FoundationElement {
        constructor() {
            super(...arguments);
            /**
             * Overrides the focus call for where delegatesFocus is unsupported.
             * This check works for Chrome, Edge Chromium, FireFox, and Safari
             * Relevant PR on the Firefox browser: https://phabricator.services.mozilla.com/D123858
             */
            this.handleUnsupportedDelegatesFocus = () => {
                var _a;
                // Check to see if delegatesFocus is supported
                if (window.ShadowRoot &&
                    !window.ShadowRoot.prototype.hasOwnProperty("delegatesFocus") && ((_a = this.$fastController.definition.shadowOptions) === null || _a === void 0 ? void 0 : _a.delegatesFocus)) {
                    this.focus = () => {
                        this.control.focus();
                    };
                }
            };
        }
        /**
         * @internal
         */
        connectedCallback() {
            super.connectedCallback();
            this.handleUnsupportedDelegatesFocus();
        }
    }
    __decorate$1([
        attr
    ], Anchor.prototype, "download", void 0);
    __decorate$1([
        attr
    ], Anchor.prototype, "href", void 0);
    __decorate$1([
        attr
    ], Anchor.prototype, "hreflang", void 0);
    __decorate$1([
        attr
    ], Anchor.prototype, "ping", void 0);
    __decorate$1([
        attr
    ], Anchor.prototype, "referrerpolicy", void 0);
    __decorate$1([
        attr
    ], Anchor.prototype, "rel", void 0);
    __decorate$1([
        attr
    ], Anchor.prototype, "target", void 0);
    __decorate$1([
        attr
    ], Anchor.prototype, "type", void 0);
    __decorate$1([
        observable
    ], Anchor.prototype, "defaultSlottedContent", void 0);
    /**
     * Includes ARIA states and properties relating to the ARIA link role
     *
     * @public
     */
    class DelegatesARIALink {
    }
    __decorate$1([
        attr({ attribute: "aria-expanded", mode: "fromView" })
    ], DelegatesARIALink.prototype, "ariaExpanded", void 0);
    applyMixins(DelegatesARIALink, ARIAGlobalStatesAndProperties);
    applyMixins(Anchor, StartEnd, DelegatesARIALink);

    /**
     * a method to determine the current localization direction of the view
     * @param rootNode - the HTMLElement to begin the query from, usually "this" when used in a component controller
     * @public
     */
    const getDirection = (rootNode) => {
        const dirNode = rootNode.closest("[dir]");
        return dirNode !== null && dirNode.dir === "rtl" ? Direction.rtl : Direction.ltr;
    };

    /**
     *  A service to batch intersection event callbacks so multiple elements can share a single observer
     *
     * @public
     */
    class IntersectionService {
        constructor() {
            this.intersectionDetector = null;
            this.observedElements = new Map();
            /**
             * Request the position of a target element
             *
             * @internal
             */
            this.requestPosition = (target, callback) => {
                var _a;
                if (this.intersectionDetector === null) {
                    return;
                }
                if (this.observedElements.has(target)) {
                    (_a = this.observedElements.get(target)) === null || _a === void 0 ? void 0 : _a.push(callback);
                    return;
                }
                this.observedElements.set(target, [callback]);
                this.intersectionDetector.observe(target);
            };
            /**
             * Cancel a position request
             *
             * @internal
             */
            this.cancelRequestPosition = (target, callback) => {
                const callbacks = this.observedElements.get(target);
                if (callbacks !== undefined) {
                    const callBackIndex = callbacks.indexOf(callback);
                    if (callBackIndex !== -1) {
                        callbacks.splice(callBackIndex, 1);
                    }
                }
            };
            /**
             * initialize intersection detector
             */
            this.initializeIntersectionDetector = () => {
                if (!$global.IntersectionObserver) {
                    //intersection observer not supported
                    return;
                }
                this.intersectionDetector = new IntersectionObserver(this.handleIntersection, {
                    root: null,
                    rootMargin: "0px",
                    threshold: [0, 1],
                });
            };
            /**
             *  Handle intersections
             */
            this.handleIntersection = (entries) => {
                if (this.intersectionDetector === null) {
                    return;
                }
                const pendingCallbacks = [];
                const pendingCallbackParams = [];
                // go through the entries to build a list of callbacks and params for each
                entries.forEach((entry) => {
                    var _a;
                    // stop watching this element until we get new update requests for it
                    (_a = this.intersectionDetector) === null || _a === void 0 ? void 0 : _a.unobserve(entry.target);
                    const thisElementCallbacks = this.observedElements.get(entry.target);
                    if (thisElementCallbacks !== undefined) {
                        thisElementCallbacks.forEach((callback) => {
                            let targetCallbackIndex = pendingCallbacks.indexOf(callback);
                            if (targetCallbackIndex === -1) {
                                targetCallbackIndex = pendingCallbacks.length;
                                pendingCallbacks.push(callback);
                                pendingCallbackParams.push([]);
                            }
                            pendingCallbackParams[targetCallbackIndex].push(entry);
                        });
                        this.observedElements.delete(entry.target);
                    }
                });
                // execute callbacks
                pendingCallbacks.forEach((callback, index) => {
                    callback(pendingCallbackParams[index]);
                });
            };
            this.initializeIntersectionDetector();
        }
    }

    /**
     * An anchored region Custom HTML Element.
     *
     * @public
     */
    class AnchoredRegion extends FoundationElement {
        constructor() {
            super(...arguments);
            /**
             * The HTML ID of the anchor element this region is positioned relative to
             *
             * @public
             * @remarks
             * HTML Attribute: anchor
             */
            this.anchor = "";
            /**
             * The HTML ID of the viewport element this region is positioned relative to
             *
             * @public
             * @remarks
             * HTML Attribute: anchor
             */
            this.viewport = "";
            /**
             * Sets what logic the component uses to determine horizontal placement.
             * 'locktodefault' forces the default position
             * 'dynamic' decides placement based on available space
             * 'uncontrolled' does not control placement on the horizontal axis
             *
             * @public
             * @remarks
             * HTML Attribute: horizontal-positioning-mode
             */
            this.horizontalPositioningMode = "uncontrolled";
            /**
             * The default horizontal position of the region relative to the anchor element
             *
             * @public
             * @remarks
             * HTML Attribute: horizontal-default-position
             */
            this.horizontalDefaultPosition = "unset";
            /**
             * Whether the region remains in the viewport (ie. detaches from the anchor) on the horizontal axis
             *
             * @public
             * @remarks
             * HTML Attribute: horizontal-viewport-lock
             */
            this.horizontalViewportLock = false;
            /**
             * Whether the region overlaps the anchor on the horizontal axis
             *
             * @public
             * @remarks
             * HTML Attribute: horizontal-inset
             */
            this.horizontalInset = false;
            /**
             * Defines how the width of the region is calculated
             *
             * @public
             * @remarks
             * HTML Attribute: horizontal-scaling
             */
            this.horizontalScaling = "content";
            /**
             * Sets what logic the component uses to determine vertical placement.
             * 'locktodefault' forces the default position
             * 'dynamic' decides placement based on available space
             * 'uncontrolled' does not control placement on the vertical axis
             *
             * @public
             * @remarks
             * HTML Attribute: vertical-positioning-mode
             */
            this.verticalPositioningMode = "uncontrolled";
            /**
             * The default vertical position of the region relative to the anchor element
             *
             * @public
             * @remarks
             * HTML Attribute: vertical-default-position
             */
            this.verticalDefaultPosition = "unset";
            /**
             * Whether the region remains in the viewport (ie. detaches from the anchor) on the vertical axis
             *
             * @public
             * @remarks
             * HTML Attribute: vertical-viewport-lock
             */
            this.verticalViewportLock = false;
            /**
             * Whether the region overlaps the anchor on the vertical axis
             *
             * @public
             * @remarks
             * HTML Attribute: vertical-inset
             */
            this.verticalInset = false;
            /**
             * Defines how the height of the region is calculated
             *
             * @public
             * @remarks
             * HTML Attribute: vertical-scaling
             */
            this.verticalScaling = "content";
            /**
             * Whether the region is positioned using css "position: fixed".
             * Otherwise the region uses "position: absolute".
             * Fixed placement allows the region to break out of parent containers,
             *
             * @public
             * @remarks
             * HTML Attribute: fixed-placement
             */
            this.fixedPlacement = false;
            /**
             * Defines what triggers the anchored region to revaluate positioning
             *
             * @public
             * @remarks
             * HTML Attribute: auto-update-mode
             */
            this.autoUpdateMode = "anchor";
            /**
             * The HTML element being used as the anchor
             *
             * @public
             */
            this.anchorElement = null;
            /**
             * The HTML element being used as the viewport
             *
             * @public
             */
            this.viewportElement = null;
            /**
             * indicates that an initial positioning pass on layout has completed
             *
             * @internal
             */
            this.initialLayoutComplete = false;
            this.resizeDetector = null;
            /**
             * base offsets between the positioner's base position and the anchor's
             */
            this.baseHorizontalOffset = 0;
            this.baseVerticalOffset = 0;
            this.pendingPositioningUpdate = false;
            this.pendingReset = false;
            this.currentDirection = Direction.ltr;
            this.regionVisible = false;
            // indicates that a layout update should occur even if geometry has not changed
            // used to ensure some attribute changes are applied
            this.forceUpdate = false;
            // defines how big a difference in pixels there must be between states to
            // justify a layout update that affects the dom (prevents repeated sub-pixel corrections)
            this.updateThreshold = 0.5;
            /**
             * update position
             */
            this.update = () => {
                if (!this.pendingPositioningUpdate) {
                    this.requestPositionUpdates();
                }
            };
            /**
             * starts observers
             */
            this.startObservers = () => {
                this.stopObservers();
                if (this.anchorElement === null) {
                    return;
                }
                this.requestPositionUpdates();
                if (this.resizeDetector !== null) {
                    this.resizeDetector.observe(this.anchorElement);
                    this.resizeDetector.observe(this);
                }
            };
            /**
             * get position updates
             */
            this.requestPositionUpdates = () => {
                if (this.anchorElement === null || this.pendingPositioningUpdate) {
                    return;
                }
                AnchoredRegion.intersectionService.requestPosition(this, this.handleIntersection);
                AnchoredRegion.intersectionService.requestPosition(this.anchorElement, this.handleIntersection);
                if (this.viewportElement !== null) {
                    AnchoredRegion.intersectionService.requestPosition(this.viewportElement, this.handleIntersection);
                }
                this.pendingPositioningUpdate = true;
            };
            /**
             * stops observers
             */
            this.stopObservers = () => {
                if (this.pendingPositioningUpdate) {
                    this.pendingPositioningUpdate = false;
                    AnchoredRegion.intersectionService.cancelRequestPosition(this, this.handleIntersection);
                    if (this.anchorElement !== null) {
                        AnchoredRegion.intersectionService.cancelRequestPosition(this.anchorElement, this.handleIntersection);
                    }
                    if (this.viewportElement !== null) {
                        AnchoredRegion.intersectionService.cancelRequestPosition(this.viewportElement, this.handleIntersection);
                    }
                }
                if (this.resizeDetector !== null) {
                    this.resizeDetector.disconnect();
                }
            };
            /**
             * Gets the viewport element by id, or defaults to document root
             */
            this.getViewport = () => {
                if (typeof this.viewport !== "string" || this.viewport === "") {
                    return document.documentElement;
                }
                return document.getElementById(this.viewport);
            };
            /**
             *  Gets the anchor element by id
             */
            this.getAnchor = () => {
                return document.getElementById(this.anchor);
            };
            /**
             *  Handle intersections
             */
            this.handleIntersection = (entries) => {
                if (!this.pendingPositioningUpdate) {
                    return;
                }
                this.pendingPositioningUpdate = false;
                if (!this.applyIntersectionEntries(entries)) {
                    return;
                }
                this.updateLayout();
            };
            /**
             *  iterate through intersection entries and apply data
             */
            this.applyIntersectionEntries = (entries) => {
                const regionEntry = entries.find(x => x.target === this);
                const anchorEntry = entries.find(x => x.target === this.anchorElement);
                const viewportEntry = entries.find(x => x.target === this.viewportElement);
                if (regionEntry === undefined ||
                    viewportEntry === undefined ||
                    anchorEntry === undefined) {
                    return false;
                }
                // don't update the dom unless there is a significant difference in rect positions
                if (!this.regionVisible ||
                    this.forceUpdate ||
                    this.regionRect === undefined ||
                    this.anchorRect === undefined ||
                    this.viewportRect === undefined ||
                    this.isRectDifferent(this.anchorRect, anchorEntry.boundingClientRect) ||
                    this.isRectDifferent(this.viewportRect, viewportEntry.boundingClientRect) ||
                    this.isRectDifferent(this.regionRect, regionEntry.boundingClientRect)) {
                    this.regionRect = regionEntry.boundingClientRect;
                    this.anchorRect = anchorEntry.boundingClientRect;
                    if (this.viewportElement === document.documentElement) {
                        this.viewportRect = new DOMRectReadOnly(viewportEntry.boundingClientRect.x +
                            document.documentElement.scrollLeft, viewportEntry.boundingClientRect.y +
                            document.documentElement.scrollTop, viewportEntry.boundingClientRect.width, viewportEntry.boundingClientRect.height);
                    }
                    else {
                        this.viewportRect = viewportEntry.boundingClientRect;
                    }
                    this.updateRegionOffset();
                    this.forceUpdate = false;
                    return true;
                }
                return false;
            };
            /**
             *  Update the offset values
             */
            this.updateRegionOffset = () => {
                if (this.anchorRect && this.regionRect) {
                    this.baseHorizontalOffset =
                        this.baseHorizontalOffset +
                            (this.anchorRect.left - this.regionRect.left) +
                            (this.translateX - this.baseHorizontalOffset);
                    this.baseVerticalOffset =
                        this.baseVerticalOffset +
                            (this.anchorRect.top - this.regionRect.top) +
                            (this.translateY - this.baseVerticalOffset);
                }
            };
            /**
             *  compare rects to see if there is enough change to justify a DOM update
             */
            this.isRectDifferent = (rectA, rectB) => {
                if (Math.abs(rectA.top - rectB.top) > this.updateThreshold ||
                    Math.abs(rectA.right - rectB.right) > this.updateThreshold ||
                    Math.abs(rectA.bottom - rectB.bottom) > this.updateThreshold ||
                    Math.abs(rectA.left - rectB.left) > this.updateThreshold) {
                    return true;
                }
                return false;
            };
            /**
             *  Handle resize events
             */
            this.handleResize = (entries) => {
                this.update();
            };
            /**
             * resets the component
             */
            this.reset = () => {
                if (!this.pendingReset) {
                    return;
                }
                this.pendingReset = false;
                if (this.anchorElement === null) {
                    this.anchorElement = this.getAnchor();
                }
                if (this.viewportElement === null) {
                    this.viewportElement = this.getViewport();
                }
                this.currentDirection = getDirection(this);
                this.startObservers();
            };
            /**
             *  Recalculate layout related state values
             */
            this.updateLayout = () => {
                let desiredVerticalPosition = undefined;
                let desiredHorizontalPosition = undefined;
                if (this.horizontalPositioningMode !== "uncontrolled") {
                    const horizontalOptions = this.getPositioningOptions(this.horizontalInset);
                    if (this.horizontalDefaultPosition === "center") {
                        desiredHorizontalPosition = "center";
                    }
                    else if (this.horizontalDefaultPosition !== "unset") {
                        let dirCorrectedHorizontalDefaultPosition = this
                            .horizontalDefaultPosition;
                        if (dirCorrectedHorizontalDefaultPosition === "start" ||
                            dirCorrectedHorizontalDefaultPosition === "end") {
                            // if direction changes we reset the layout
                            const newDirection = getDirection(this);
                            if (newDirection !== this.currentDirection) {
                                this.currentDirection = newDirection;
                                this.initialize();
                                return;
                            }
                            if (this.currentDirection === Direction.ltr) {
                                dirCorrectedHorizontalDefaultPosition =
                                    dirCorrectedHorizontalDefaultPosition === "start"
                                        ? "left"
                                        : "right";
                            }
                            else {
                                dirCorrectedHorizontalDefaultPosition =
                                    dirCorrectedHorizontalDefaultPosition === "start"
                                        ? "right"
                                        : "left";
                            }
                        }
                        switch (dirCorrectedHorizontalDefaultPosition) {
                            case "left":
                                desiredHorizontalPosition = this.horizontalInset
                                    ? "insetStart"
                                    : "start";
                                break;
                            case "right":
                                desiredHorizontalPosition = this.horizontalInset
                                    ? "insetEnd"
                                    : "end";
                                break;
                        }
                    }
                    const horizontalThreshold = this.horizontalThreshold !== undefined
                        ? this.horizontalThreshold
                        : this.regionRect !== undefined
                            ? this.regionRect.width
                            : 0;
                    const anchorLeft = this.anchorRect !== undefined ? this.anchorRect.left : 0;
                    const anchorRight = this.anchorRect !== undefined ? this.anchorRect.right : 0;
                    const anchorWidth = this.anchorRect !== undefined ? this.anchorRect.width : 0;
                    const viewportLeft = this.viewportRect !== undefined ? this.viewportRect.left : 0;
                    const viewportRight = this.viewportRect !== undefined ? this.viewportRect.right : 0;
                    if (desiredHorizontalPosition === undefined ||
                        (!(this.horizontalPositioningMode === "locktodefault") &&
                            this.getAvailableSpace(desiredHorizontalPosition, anchorLeft, anchorRight, anchorWidth, viewportLeft, viewportRight) < horizontalThreshold)) {
                        desiredHorizontalPosition =
                            this.getAvailableSpace(horizontalOptions[0], anchorLeft, anchorRight, anchorWidth, viewportLeft, viewportRight) >
                                this.getAvailableSpace(horizontalOptions[1], anchorLeft, anchorRight, anchorWidth, viewportLeft, viewportRight)
                                ? horizontalOptions[0]
                                : horizontalOptions[1];
                    }
                }
                if (this.verticalPositioningMode !== "uncontrolled") {
                    const verticalOptions = this.getPositioningOptions(this.verticalInset);
                    if (this.verticalDefaultPosition === "center") {
                        desiredVerticalPosition = "center";
                    }
                    else if (this.verticalDefaultPosition !== "unset") {
                        switch (this.verticalDefaultPosition) {
                            case "top":
                                desiredVerticalPosition = this.verticalInset
                                    ? "insetStart"
                                    : "start";
                                break;
                            case "bottom":
                                desiredVerticalPosition = this.verticalInset ? "insetEnd" : "end";
                                break;
                        }
                    }
                    const verticalThreshold = this.verticalThreshold !== undefined
                        ? this.verticalThreshold
                        : this.regionRect !== undefined
                            ? this.regionRect.height
                            : 0;
                    const anchorTop = this.anchorRect !== undefined ? this.anchorRect.top : 0;
                    const anchorBottom = this.anchorRect !== undefined ? this.anchorRect.bottom : 0;
                    const anchorHeight = this.anchorRect !== undefined ? this.anchorRect.height : 0;
                    const viewportTop = this.viewportRect !== undefined ? this.viewportRect.top : 0;
                    const viewportBottom = this.viewportRect !== undefined ? this.viewportRect.bottom : 0;
                    if (desiredVerticalPosition === undefined ||
                        (!(this.verticalPositioningMode === "locktodefault") &&
                            this.getAvailableSpace(desiredVerticalPosition, anchorTop, anchorBottom, anchorHeight, viewportTop, viewportBottom) < verticalThreshold)) {
                        desiredVerticalPosition =
                            this.getAvailableSpace(verticalOptions[0], anchorTop, anchorBottom, anchorHeight, viewportTop, viewportBottom) >
                                this.getAvailableSpace(verticalOptions[1], anchorTop, anchorBottom, anchorHeight, viewportTop, viewportBottom)
                                ? verticalOptions[0]
                                : verticalOptions[1];
                    }
                }
                const nextPositionerDimension = this.getNextRegionDimension(desiredHorizontalPosition, desiredVerticalPosition);
                const positionChanged = this.horizontalPosition !== desiredHorizontalPosition ||
                    this.verticalPosition !== desiredVerticalPosition;
                this.setHorizontalPosition(desiredHorizontalPosition, nextPositionerDimension);
                this.setVerticalPosition(desiredVerticalPosition, nextPositionerDimension);
                this.updateRegionStyle();
                if (!this.initialLayoutComplete) {
                    this.initialLayoutComplete = true;
                    this.requestPositionUpdates();
                    return;
                }
                if (!this.regionVisible) {
                    this.regionVisible = true;
                    this.style.removeProperty("pointer-events");
                    this.style.removeProperty("opacity");
                    this.classList.toggle("loaded", true);
                    this.$emit("loaded", this, { bubbles: false });
                }
                this.updatePositionClasses();
                if (positionChanged) {
                    // emit change event
                    this.$emit("positionchange", this, { bubbles: false });
                }
            };
            /**
             *  Updates the style string applied to the region element as well as the css classes attached
             *  to the root element
             */
            this.updateRegionStyle = () => {
                this.style.width = this.regionWidth;
                this.style.height = this.regionHeight;
                this.style.transform = `translate(${this.translateX}px, ${this.translateY}px)`;
            };
            /**
             *  Updates the css classes that reflect the current position of the element
             */
            this.updatePositionClasses = () => {
                this.classList.toggle("top", this.verticalPosition === "start");
                this.classList.toggle("bottom", this.verticalPosition === "end");
                this.classList.toggle("inset-top", this.verticalPosition === "insetStart");
                this.classList.toggle("inset-bottom", this.verticalPosition === "insetEnd");
                this.classList.toggle("vertical-center", this.verticalPosition === "center");
                this.classList.toggle("left", this.horizontalPosition === "start");
                this.classList.toggle("right", this.horizontalPosition === "end");
                this.classList.toggle("inset-left", this.horizontalPosition === "insetStart");
                this.classList.toggle("inset-right", this.horizontalPosition === "insetEnd");
                this.classList.toggle("horizontal-center", this.horizontalPosition === "center");
            };
            /**
             * Get horizontal positioning state based on desired position
             */
            this.setHorizontalPosition = (desiredHorizontalPosition, nextPositionerDimension) => {
                if (desiredHorizontalPosition === undefined ||
                    this.regionRect === undefined ||
                    this.anchorRect === undefined ||
                    this.viewportRect === undefined) {
                    return;
                }
                let nextRegionWidth = 0;
                switch (this.horizontalScaling) {
                    case "anchor":
                    case "fill":
                        nextRegionWidth = nextPositionerDimension.width;
                        this.regionWidth = `${nextRegionWidth}px`;
                        break;
                    case "content":
                        nextRegionWidth = this.regionRect.width;
                        this.regionWidth = "unset";
                        break;
                }
                let sizeDelta = 0;
                switch (desiredHorizontalPosition) {
                    case "start":
                        this.translateX = this.baseHorizontalOffset - nextRegionWidth;
                        if (this.horizontalViewportLock &&
                            this.anchorRect.left > this.viewportRect.right) {
                            this.translateX =
                                this.translateX -
                                    (this.anchorRect.left - this.viewportRect.right);
                        }
                        break;
                    case "insetStart":
                        this.translateX =
                            this.baseHorizontalOffset - nextRegionWidth + this.anchorRect.width;
                        if (this.horizontalViewportLock &&
                            this.anchorRect.right > this.viewportRect.right) {
                            this.translateX =
                                this.translateX -
                                    (this.anchorRect.right - this.viewportRect.right);
                        }
                        break;
                    case "insetEnd":
                        this.translateX = this.baseHorizontalOffset;
                        if (this.horizontalViewportLock &&
                            this.anchorRect.left < this.viewportRect.left) {
                            this.translateX =
                                this.translateX - (this.anchorRect.left - this.viewportRect.left);
                        }
                        break;
                    case "end":
                        this.translateX = this.baseHorizontalOffset + this.anchorRect.width;
                        if (this.horizontalViewportLock &&
                            this.anchorRect.right < this.viewportRect.left) {
                            this.translateX =
                                this.translateX -
                                    (this.anchorRect.right - this.viewportRect.left);
                        }
                        break;
                    case "center":
                        sizeDelta = (this.anchorRect.width - nextRegionWidth) / 2;
                        this.translateX = this.baseHorizontalOffset + sizeDelta;
                        if (this.horizontalViewportLock) {
                            const regionLeft = this.anchorRect.left + sizeDelta;
                            const regionRight = this.anchorRect.right - sizeDelta;
                            if (regionLeft < this.viewportRect.left &&
                                !(regionRight > this.viewportRect.right)) {
                                this.translateX =
                                    this.translateX - (regionLeft - this.viewportRect.left);
                            }
                            else if (regionRight > this.viewportRect.right &&
                                !(regionLeft < this.viewportRect.left)) {
                                this.translateX =
                                    this.translateX - (regionRight - this.viewportRect.right);
                            }
                        }
                        break;
                }
                this.horizontalPosition = desiredHorizontalPosition;
            };
            /**
             * Set vertical positioning state based on desired position
             */
            this.setVerticalPosition = (desiredVerticalPosition, nextPositionerDimension) => {
                if (desiredVerticalPosition === undefined ||
                    this.regionRect === undefined ||
                    this.anchorRect === undefined ||
                    this.viewportRect === undefined) {
                    return;
                }
                let nextRegionHeight = 0;
                switch (this.verticalScaling) {
                    case "anchor":
                    case "fill":
                        nextRegionHeight = nextPositionerDimension.height;
                        this.regionHeight = `${nextRegionHeight}px`;
                        break;
                    case "content":
                        nextRegionHeight = this.regionRect.height;
                        this.regionHeight = "unset";
                        break;
                }
                let sizeDelta = 0;
                switch (desiredVerticalPosition) {
                    case "start":
                        this.translateY = this.baseVerticalOffset - nextRegionHeight;
                        if (this.verticalViewportLock &&
                            this.anchorRect.top > this.viewportRect.bottom) {
                            this.translateY =
                                this.translateY -
                                    (this.anchorRect.top - this.viewportRect.bottom);
                        }
                        break;
                    case "insetStart":
                        this.translateY =
                            this.baseVerticalOffset - nextRegionHeight + this.anchorRect.height;
                        if (this.verticalViewportLock &&
                            this.anchorRect.bottom > this.viewportRect.bottom) {
                            this.translateY =
                                this.translateY -
                                    (this.anchorRect.bottom - this.viewportRect.bottom);
                        }
                        break;
                    case "insetEnd":
                        this.translateY = this.baseVerticalOffset;
                        if (this.verticalViewportLock &&
                            this.anchorRect.top < this.viewportRect.top) {
                            this.translateY =
                                this.translateY - (this.anchorRect.top - this.viewportRect.top);
                        }
                        break;
                    case "end":
                        this.translateY = this.baseVerticalOffset + this.anchorRect.height;
                        if (this.verticalViewportLock &&
                            this.anchorRect.bottom < this.viewportRect.top) {
                            this.translateY =
                                this.translateY -
                                    (this.anchorRect.bottom - this.viewportRect.top);
                        }
                        break;
                    case "center":
                        sizeDelta = (this.anchorRect.height - nextRegionHeight) / 2;
                        this.translateY = this.baseVerticalOffset + sizeDelta;
                        if (this.verticalViewportLock) {
                            const regionTop = this.anchorRect.top + sizeDelta;
                            const regionBottom = this.anchorRect.bottom - sizeDelta;
                            if (regionTop < this.viewportRect.top &&
                                !(regionBottom > this.viewportRect.bottom)) {
                                this.translateY =
                                    this.translateY - (regionTop - this.viewportRect.top);
                            }
                            else if (regionBottom > this.viewportRect.bottom &&
                                !(regionTop < this.viewportRect.top)) {
                                this.translateY =
                                    this.translateY - (regionBottom - this.viewportRect.bottom);
                            }
                        }
                }
                this.verticalPosition = desiredVerticalPosition;
            };
            /**
             *  Get available positions based on positioning mode
             */
            this.getPositioningOptions = (inset) => {
                if (inset) {
                    return ["insetStart", "insetEnd"];
                }
                return ["start", "end"];
            };
            /**
             *  Get the space available for a particular relative position
             */
            this.getAvailableSpace = (positionOption, anchorStart, anchorEnd, anchorSpan, viewportStart, viewportEnd) => {
                const spaceStart = anchorStart - viewportStart;
                const spaceEnd = viewportEnd - (anchorStart + anchorSpan);
                switch (positionOption) {
                    case "start":
                        return spaceStart;
                    case "insetStart":
                        return spaceStart + anchorSpan;
                    case "insetEnd":
                        return spaceEnd + anchorSpan;
                    case "end":
                        return spaceEnd;
                    case "center":
                        return Math.min(spaceStart, spaceEnd) * 2 + anchorSpan;
                }
            };
            /**
             * Get region dimensions
             */
            this.getNextRegionDimension = (desiredHorizontalPosition, desiredVerticalPosition) => {
                const newRegionDimension = {
                    height: this.regionRect !== undefined ? this.regionRect.height : 0,
                    width: this.regionRect !== undefined ? this.regionRect.width : 0,
                };
                if (desiredHorizontalPosition !== undefined &&
                    this.horizontalScaling === "fill") {
                    newRegionDimension.width = this.getAvailableSpace(desiredHorizontalPosition, this.anchorRect !== undefined ? this.anchorRect.left : 0, this.anchorRect !== undefined ? this.anchorRect.right : 0, this.anchorRect !== undefined ? this.anchorRect.width : 0, this.viewportRect !== undefined ? this.viewportRect.left : 0, this.viewportRect !== undefined ? this.viewportRect.right : 0);
                }
                else if (this.horizontalScaling === "anchor") {
                    newRegionDimension.width =
                        this.anchorRect !== undefined ? this.anchorRect.width : 0;
                }
                if (desiredVerticalPosition !== undefined && this.verticalScaling === "fill") {
                    newRegionDimension.height = this.getAvailableSpace(desiredVerticalPosition, this.anchorRect !== undefined ? this.anchorRect.top : 0, this.anchorRect !== undefined ? this.anchorRect.bottom : 0, this.anchorRect !== undefined ? this.anchorRect.height : 0, this.viewportRect !== undefined ? this.viewportRect.top : 0, this.viewportRect !== undefined ? this.viewportRect.bottom : 0);
                }
                else if (this.verticalScaling === "anchor") {
                    newRegionDimension.height =
                        this.anchorRect !== undefined ? this.anchorRect.height : 0;
                }
                return newRegionDimension;
            };
            /**
             * starts event listeners that can trigger auto updating
             */
            this.startAutoUpdateEventListeners = () => {
                window.addEventListener(eventResize, this.update, { passive: true });
                window.addEventListener(eventScroll, this.update, {
                    passive: true,
                    capture: true,
                });
                if (this.resizeDetector !== null && this.viewportElement !== null) {
                    this.resizeDetector.observe(this.viewportElement);
                }
            };
            /**
             * stops event listeners that can trigger auto updating
             */
            this.stopAutoUpdateEventListeners = () => {
                window.removeEventListener(eventResize, this.update);
                window.removeEventListener(eventScroll, this.update);
                if (this.resizeDetector !== null && this.viewportElement !== null) {
                    this.resizeDetector.unobserve(this.viewportElement);
                }
            };
        }
        anchorChanged() {
            if (this.initialLayoutComplete) {
                this.anchorElement = this.getAnchor();
            }
        }
        viewportChanged() {
            if (this.initialLayoutComplete) {
                this.viewportElement = this.getViewport();
            }
        }
        horizontalPositioningModeChanged() {
            this.requestReset();
        }
        horizontalDefaultPositionChanged() {
            this.updateForAttributeChange();
        }
        horizontalViewportLockChanged() {
            this.updateForAttributeChange();
        }
        horizontalInsetChanged() {
            this.updateForAttributeChange();
        }
        horizontalThresholdChanged() {
            this.updateForAttributeChange();
        }
        horizontalScalingChanged() {
            this.updateForAttributeChange();
        }
        verticalPositioningModeChanged() {
            this.requestReset();
        }
        verticalDefaultPositionChanged() {
            this.updateForAttributeChange();
        }
        verticalViewportLockChanged() {
            this.updateForAttributeChange();
        }
        verticalInsetChanged() {
            this.updateForAttributeChange();
        }
        verticalThresholdChanged() {
            this.updateForAttributeChange();
        }
        verticalScalingChanged() {
            this.updateForAttributeChange();
        }
        fixedPlacementChanged() {
            if (this.$fastController.isConnected &&
                this.initialLayoutComplete) {
                this.initialize();
            }
        }
        autoUpdateModeChanged(prevMode, newMode) {
            if (this.$fastController.isConnected &&
                this.initialLayoutComplete) {
                if (prevMode === "auto") {
                    this.stopAutoUpdateEventListeners();
                }
                if (newMode === "auto") {
                    this.startAutoUpdateEventListeners();
                }
            }
        }
        anchorElementChanged() {
            this.requestReset();
        }
        viewportElementChanged() {
            if (this.$fastController.isConnected &&
                this.initialLayoutComplete) {
                this.initialize();
            }
        }
        /**
         * @internal
         */
        connectedCallback() {
            super.connectedCallback();
            if (this.autoUpdateMode === "auto") {
                this.startAutoUpdateEventListeners();
            }
            this.initialize();
        }
        /**
         * @internal
         */
        disconnectedCallback() {
            super.disconnectedCallback();
            if (this.autoUpdateMode === "auto") {
                this.stopAutoUpdateEventListeners();
            }
            this.stopObservers();
            this.disconnectResizeDetector();
        }
        /**
         * @internal
         */
        adoptedCallback() {
            this.initialize();
        }
        /**
         * destroys the instance's resize observer
         */
        disconnectResizeDetector() {
            if (this.resizeDetector !== null) {
                this.resizeDetector.disconnect();
                this.resizeDetector = null;
            }
        }
        /**
         * initializes the instance's resize observer
         */
        initializeResizeDetector() {
            this.disconnectResizeDetector();
            this.resizeDetector = new window.ResizeObserver(this.handleResize);
        }
        /**
         * react to attribute changes that don't require a reset
         */
        updateForAttributeChange() {
            if (this.$fastController.isConnected &&
                this.initialLayoutComplete) {
                this.forceUpdate = true;
                this.update();
            }
        }
        /**
         * fully initializes the component
         */
        initialize() {
            this.initializeResizeDetector();
            if (this.anchorElement === null) {
                this.anchorElement = this.getAnchor();
            }
            this.requestReset();
        }
        /**
         * Request a reset if there are currently no open requests
         */
        requestReset() {
            if (this.$fastController.isConnected &&
                this.pendingReset === false) {
                this.setInitialState();
                DOM.queueUpdate(() => this.reset());
                this.pendingReset = true;
            }
        }
        /**
         * sets the starting configuration for component internal values
         */
        setInitialState() {
            this.initialLayoutComplete = false;
            this.regionVisible = false;
            this.translateX = 0;
            this.translateY = 0;
            this.baseHorizontalOffset = 0;
            this.baseVerticalOffset = 0;
            this.viewportRect = undefined;
            this.regionRect = undefined;
            this.anchorRect = undefined;
            this.verticalPosition = undefined;
            this.horizontalPosition = undefined;
            this.style.opacity = "0";
            this.style.pointerEvents = "none";
            this.forceUpdate = false;
            this.style.position = this.fixedPlacement ? "fixed" : "absolute";
            this.updatePositionClasses();
            this.updateRegionStyle();
        }
    }
    AnchoredRegion.intersectionService = new IntersectionService();
    __decorate$1([
        attr
    ], AnchoredRegion.prototype, "anchor", void 0);
    __decorate$1([
        attr
    ], AnchoredRegion.prototype, "viewport", void 0);
    __decorate$1([
        attr({ attribute: "horizontal-positioning-mode" })
    ], AnchoredRegion.prototype, "horizontalPositioningMode", void 0);
    __decorate$1([
        attr({ attribute: "horizontal-default-position" })
    ], AnchoredRegion.prototype, "horizontalDefaultPosition", void 0);
    __decorate$1([
        attr({ attribute: "horizontal-viewport-lock", mode: "boolean" })
    ], AnchoredRegion.prototype, "horizontalViewportLock", void 0);
    __decorate$1([
        attr({ attribute: "horizontal-inset", mode: "boolean" })
    ], AnchoredRegion.prototype, "horizontalInset", void 0);
    __decorate$1([
        attr({ attribute: "horizontal-threshold" })
    ], AnchoredRegion.prototype, "horizontalThreshold", void 0);
    __decorate$1([
        attr({ attribute: "horizontal-scaling" })
    ], AnchoredRegion.prototype, "horizontalScaling", void 0);
    __decorate$1([
        attr({ attribute: "vertical-positioning-mode" })
    ], AnchoredRegion.prototype, "verticalPositioningMode", void 0);
    __decorate$1([
        attr({ attribute: "vertical-default-position" })
    ], AnchoredRegion.prototype, "verticalDefaultPosition", void 0);
    __decorate$1([
        attr({ attribute: "vertical-viewport-lock", mode: "boolean" })
    ], AnchoredRegion.prototype, "verticalViewportLock", void 0);
    __decorate$1([
        attr({ attribute: "vertical-inset", mode: "boolean" })
    ], AnchoredRegion.prototype, "verticalInset", void 0);
    __decorate$1([
        attr({ attribute: "vertical-threshold" })
    ], AnchoredRegion.prototype, "verticalThreshold", void 0);
    __decorate$1([
        attr({ attribute: "vertical-scaling" })
    ], AnchoredRegion.prototype, "verticalScaling", void 0);
    __decorate$1([
        attr({ attribute: "fixed-placement", mode: "boolean" })
    ], AnchoredRegion.prototype, "fixedPlacement", void 0);
    __decorate$1([
        attr({ attribute: "auto-update-mode" })
    ], AnchoredRegion.prototype, "autoUpdateMode", void 0);
    __decorate$1([
        observable
    ], AnchoredRegion.prototype, "anchorElement", void 0);
    __decorate$1([
        observable
    ], AnchoredRegion.prototype, "viewportElement", void 0);
    __decorate$1([
        observable
    ], AnchoredRegion.prototype, "initialLayoutComplete", void 0);

    /**
     * The template for the {@link @microsoft/fast-foundation#(BreadcrumbItem:class)} component.
     * @public
     */
    const breadcrumbItemTemplate = (context, definition) => html `
    <div role="listitem" class="listitem" part="listitem">
        ${when(x => x.href && x.href.length > 0, html `
                ${anchorTemplate(context, definition)}
            `)}
        ${when(x => !x.href, html `
                ${startSlotTemplate(context, definition)}
                <slot></slot>
                ${endSlotTemplate(context, definition)}
            `)}
        ${when(x => x.separator, html `
                <span class="separator" part="separator" aria-hidden="true">
                    <slot name="separator">${definition.separator || ""}</slot>
                </span>
            `)}
    </div>
`;

    /**
     * A Breadcrumb Item Custom HTML Element.
     *
     * @public
     */
    class BreadcrumbItem$1 extends Anchor {
        constructor() {
            super(...arguments);
            /**
             * @internal
             */
            this.separator = true;
        }
    }
    __decorate$1([
        observable
    ], BreadcrumbItem$1.prototype, "separator", void 0);
    applyMixins(BreadcrumbItem$1, StartEnd, DelegatesARIALink);

    /**
     * The template for the {@link @microsoft/fast-foundation#Breadcrumb} component.
     * @public
     */
    const breadcrumbTemplate = (context, definition) => html `
    <template role="navigation">
        <div role="list" class="list" part="list">
            <slot
                ${slotted({ property: "slottedBreadcrumbItems", filter: elements() })}
            ></slot>
        </div>
    </template>
`;

    /**
     * A Breadcrumb Custom HTML Element.
     *
     * @public
     */
    class Breadcrumb$1 extends FoundationElement {
        slottedBreadcrumbItemsChanged() {
            if (this.$fastController.isConnected) {
                if (this.slottedBreadcrumbItems === undefined ||
                    this.slottedBreadcrumbItems.length === 0) {
                    return;
                }
                const lastNode = this.slottedBreadcrumbItems[this.slottedBreadcrumbItems.length - 1];
                this.setItemSeparator(lastNode);
                this.setLastItemAriaCurrent(lastNode);
            }
        }
        setItemSeparator(lastNode) {
            this.slottedBreadcrumbItems.forEach((item) => {
                if (item instanceof BreadcrumbItem$1) {
                    item.separator = true;
                }
            });
            if (lastNode instanceof BreadcrumbItem$1) {
                lastNode.separator = false;
            }
        }
        /**
         * @internal
         * Finds href on childnodes in the light DOM or shadow DOM.
         * We look in the shadow DOM because we insert an anchor when breadcrumb-item has an href.
         */
        findChildWithHref(node) {
            var _a, _b;
            if (node.childElementCount > 0) {
                return node.querySelector("a[href]");
            }
            else if ((_a = node.shadowRoot) === null || _a === void 0 ? void 0 : _a.childElementCount) {
                return (_b = node.shadowRoot) === null || _b === void 0 ? void 0 : _b.querySelector("a[href]");
            }
            else
                return null;
        }
        /**
         *  If child node with an anchor tag and with href is found then apply aria-current to child node otherwise apply aria-current to the host element, with an href
         */
        setLastItemAriaCurrent(lastNode) {
            const childNodeWithHref = this.findChildWithHref(lastNode);
            if (childNodeWithHref === null &&
                lastNode.hasAttribute("href") &&
                lastNode instanceof BreadcrumbItem$1) {
                lastNode.ariaCurrent = "page";
            }
            else if (childNodeWithHref !== null) {
                childNodeWithHref.setAttribute("aria-current", "page");
            }
        }
    }
    __decorate$1([
        observable
    ], Breadcrumb$1.prototype, "slottedBreadcrumbItems", void 0);

    /**
     * The template for the {@link @microsoft/fast-foundation#(Button:class)} component.
     * @public
     */
    const buttonTemplate = (context, definition) => html `
    <button
        class="control"
        part="control"
        ?autofocus="${x => x.autofocus}"
        ?disabled="${x => x.disabled}"
        form="${x => x.formId}"
        formaction="${x => x.formaction}"
        formenctype="${x => x.formenctype}"
        formmethod="${x => x.formmethod}"
        formnovalidate="${x => x.formnovalidate}"
        formtarget="${x => x.formtarget}"
        name="${x => x.name}"
        type="${x => x.type}"
        value="${x => x.value}"
        aria-atomic="${x => x.ariaAtomic}"
        aria-busy="${x => x.ariaBusy}"
        aria-controls="${x => x.ariaControls}"
        aria-current="${x => x.ariaCurrent}"
        aria-describedby="${x => x.ariaDescribedby}"
        aria-details="${x => x.ariaDetails}"
        aria-disabled="${x => x.ariaDisabled}"
        aria-errormessage="${x => x.ariaErrormessage}"
        aria-expanded="${x => x.ariaExpanded}"
        aria-flowto="${x => x.ariaFlowto}"
        aria-haspopup="${x => x.ariaHaspopup}"
        aria-hidden="${x => x.ariaHidden}"
        aria-invalid="${x => x.ariaInvalid}"
        aria-keyshortcuts="${x => x.ariaKeyshortcuts}"
        aria-label="${x => x.ariaLabel}"
        aria-labelledby="${x => x.ariaLabelledby}"
        aria-live="${x => x.ariaLive}"
        aria-owns="${x => x.ariaOwns}"
        aria-pressed="${x => x.ariaPressed}"
        aria-relevant="${x => x.ariaRelevant}"
        aria-roledescription="${x => x.ariaRoledescription}"
        ${ref("control")}
    >
        ${startSlotTemplate(context, definition)}
        <span class="content" part="content">
            <slot ${slotted("defaultSlottedContent")}></slot>
        </span>
        ${endSlotTemplate(context, definition)}
    </button>
`;

    const proxySlotName = "form-associated-proxy";
    const ElementInternalsKey = "ElementInternals";
    /**
     * @alpha
     */
    const supportsElementInternals = ElementInternalsKey in window &&
        "setFormValue" in window[ElementInternalsKey].prototype;
    const InternalsMap = new WeakMap();
    /**
     * Base function for providing Custom Element Form Association.
     *
     * @alpha
     */
    function FormAssociated(BaseCtor) {
        const C = class extends BaseCtor {
            constructor(...args) {
                super(...args);
                /**
                 * Track whether the value has been changed from the initial value
                 */
                this.dirtyValue = false;
                /**
                 * Sets the element's disabled state. A disabled element will not be included during form submission.
                 *
                 * @remarks
                 * HTML Attribute: disabled
                 */
                this.disabled = false;
                /**
                 * These are events that are still fired by the proxy
                 * element based on user / programmatic interaction.
                 *
                 * The proxy implementation should be transparent to
                 * the app author, so block these events from emitting.
                 */
                this.proxyEventsToBlock = ["change", "click"];
                this.proxyInitialized = false;
                this.required = false;
                this.initialValue = this.initialValue || "";
                if (!this.elementInternals) {
                    // When elementInternals is not supported, formResetCallback is
                    // bound to an event listener, so ensure the handler's `this`
                    // context is correct.
                    this.formResetCallback = this.formResetCallback.bind(this);
                }
            }
            /**
             * Must evaluate to true to enable elementInternals.
             * Feature detects API support and resolve respectively
             *
             * @internal
             */
            static get formAssociated() {
                return supportsElementInternals;
            }
            /**
             * Returns the validity state of the element
             *
             * @alpha
             */
            get validity() {
                return this.elementInternals
                    ? this.elementInternals.validity
                    : this.proxy.validity;
            }
            /**
             * Retrieve a reference to the associated form.
             * Returns null if not associated to any form.
             *
             * @alpha
             */
            get form() {
                return this.elementInternals ? this.elementInternals.form : this.proxy.form;
            }
            /**
             * Retrieve the localized validation message,
             * or custom validation message if set.
             *
             * @alpha
             */
            get validationMessage() {
                return this.elementInternals
                    ? this.elementInternals.validationMessage
                    : this.proxy.validationMessage;
            }
            /**
             * Whether the element will be validated when the
             * form is submitted
             */
            get willValidate() {
                return this.elementInternals
                    ? this.elementInternals.willValidate
                    : this.proxy.willValidate;
            }
            /**
             * A reference to all associated label elements
             */
            get labels() {
                if (this.elementInternals) {
                    return Object.freeze(Array.from(this.elementInternals.labels));
                }
                else if (this.proxy instanceof HTMLElement &&
                    this.proxy.ownerDocument &&
                    this.id) {
                    // Labels associated by wrapping the element: <label><custom-element></custom-element></label>
                    const parentLabels = this.proxy.labels;
                    // Labels associated using the `for` attribute
                    const forLabels = Array.from(this.proxy.getRootNode().querySelectorAll(`[for='${this.id}']`));
                    const labels = parentLabels
                        ? forLabels.concat(Array.from(parentLabels))
                        : forLabels;
                    return Object.freeze(labels);
                }
                else {
                    return emptyArray;
                }
            }
            /**
             * Invoked when the `value` property changes
             * @param previous - the previous value
             * @param next - the new value
             *
             * @remarks
             * If elements extending `FormAssociated` implement a `valueChanged` method
             * They must be sure to invoke `super.valueChanged(previous, next)` to ensure
             * proper functioning of `FormAssociated`
             */
            valueChanged(previous, next) {
                this.dirtyValue = true;
                if (this.proxy instanceof HTMLElement) {
                    this.proxy.value = this.value;
                }
                this.currentValue = this.value;
                this.setFormValue(this.value);
                this.validate();
            }
            currentValueChanged() {
                this.value = this.currentValue;
            }
            /**
             * Invoked when the `initialValue` property changes
             *
             * @param previous - the previous value
             * @param next - the new value
             *
             * @remarks
             * If elements extending `FormAssociated` implement a `initialValueChanged` method
             * They must be sure to invoke `super.initialValueChanged(previous, next)` to ensure
             * proper functioning of `FormAssociated`
             */
            initialValueChanged(previous, next) {
                // If the value is clean and the component is connected to the DOM
                // then set value equal to the attribute value.
                if (!this.dirtyValue) {
                    this.value = this.initialValue;
                    this.dirtyValue = false;
                }
            }
            /**
             * Invoked when the `disabled` property changes
             *
             * @param previous - the previous value
             * @param next - the new value
             *
             * @remarks
             * If elements extending `FormAssociated` implement a `disabledChanged` method
             * They must be sure to invoke `super.disabledChanged(previous, next)` to ensure
             * proper functioning of `FormAssociated`
             */
            disabledChanged(previous, next) {
                if (this.proxy instanceof HTMLElement) {
                    this.proxy.disabled = this.disabled;
                }
                DOM.queueUpdate(() => this.classList.toggle("disabled", this.disabled));
            }
            /**
             * Invoked when the `name` property changes
             *
             * @param previous - the previous value
             * @param next - the new value
             *
             * @remarks
             * If elements extending `FormAssociated` implement a `nameChanged` method
             * They must be sure to invoke `super.nameChanged(previous, next)` to ensure
             * proper functioning of `FormAssociated`
             */
            nameChanged(previous, next) {
                if (this.proxy instanceof HTMLElement) {
                    this.proxy.name = this.name;
                }
            }
            /**
             * Invoked when the `required` property changes
             *
             * @param previous - the previous value
             * @param next - the new value
             *
             * @remarks
             * If elements extending `FormAssociated` implement a `requiredChanged` method
             * They must be sure to invoke `super.requiredChanged(previous, next)` to ensure
             * proper functioning of `FormAssociated`
             */
            requiredChanged(prev, next) {
                if (this.proxy instanceof HTMLElement) {
                    this.proxy.required = this.required;
                }
                DOM.queueUpdate(() => this.classList.toggle("required", this.required));
                this.validate();
            }
            /**
             * The element internals object. Will only exist
             * in browsers supporting the attachInternals API
             */
            get elementInternals() {
                if (!supportsElementInternals) {
                    return null;
                }
                let internals = InternalsMap.get(this);
                if (!internals) {
                    internals = this.attachInternals();
                    InternalsMap.set(this, internals);
                }
                return internals;
            }
            /**
             * @internal
             */
            connectedCallback() {
                super.connectedCallback();
                this.addEventListener("keypress", this._keypressHandler);
                if (!this.value) {
                    this.value = this.initialValue;
                    this.dirtyValue = false;
                }
                if (!this.elementInternals) {
                    this.attachProxy();
                    if (this.form) {
                        this.form.addEventListener("reset", this.formResetCallback);
                    }
                }
            }
            /**
             * @internal
             */
            disconnectedCallback() {
                this.proxyEventsToBlock.forEach(name => this.proxy.removeEventListener(name, this.stopPropagation));
                if (!this.elementInternals && this.form) {
                    this.form.removeEventListener("reset", this.formResetCallback);
                }
            }
            /**
             * Return the current validity of the element.
             */
            checkValidity() {
                return this.elementInternals
                    ? this.elementInternals.checkValidity()
                    : this.proxy.checkValidity();
            }
            /**
             * Return the current validity of the element.
             * If false, fires an invalid event at the element.
             */
            reportValidity() {
                return this.elementInternals
                    ? this.elementInternals.reportValidity()
                    : this.proxy.reportValidity();
            }
            /**
             * Set the validity of the control. In cases when the elementInternals object is not
             * available (and the proxy element is used to report validity), this function will
             * do nothing unless a message is provided, at which point the setCustomValidity method
             * of the proxy element will be invoked with the provided message.
             * @param flags - Validity flags
             * @param message - Optional message to supply
             * @param anchor - Optional element used by UA to display an interactive validation UI
             */
            setValidity(flags, message, anchor) {
                if (this.elementInternals) {
                    this.elementInternals.setValidity(flags, message, anchor);
                }
                else if (typeof message === "string") {
                    this.proxy.setCustomValidity(message);
                }
            }
            /**
             * Invoked when a connected component's form or fieldset has its disabled
             * state changed.
             * @param disabled - the disabled value of the form / fieldset
             */
            formDisabledCallback(disabled) {
                this.disabled = disabled;
            }
            formResetCallback() {
                this.value = this.initialValue;
                this.dirtyValue = false;
            }
            /**
             * Attach the proxy element to the DOM
             */
            attachProxy() {
                var _a;
                if (!this.proxyInitialized) {
                    this.proxyInitialized = true;
                    this.proxy.style.display = "none";
                    this.proxyEventsToBlock.forEach(name => this.proxy.addEventListener(name, this.stopPropagation));
                    // These are typically mapped to the proxy during
                    // property change callbacks, but during initialization
                    // on the initial call of the callback, the proxy is
                    // still undefined. We should find a better way to address this.
                    this.proxy.disabled = this.disabled;
                    this.proxy.required = this.required;
                    if (typeof this.name === "string") {
                        this.proxy.name = this.name;
                    }
                    if (typeof this.value === "string") {
                        this.proxy.value = this.value;
                    }
                    this.proxy.setAttribute("slot", proxySlotName);
                    this.proxySlot = document.createElement("slot");
                    this.proxySlot.setAttribute("name", proxySlotName);
                }
                (_a = this.shadowRoot) === null || _a === void 0 ? void 0 : _a.appendChild(this.proxySlot);
                this.appendChild(this.proxy);
            }
            /**
             * Detach the proxy element from the DOM
             */
            detachProxy() {
                var _a;
                this.removeChild(this.proxy);
                (_a = this.shadowRoot) === null || _a === void 0 ? void 0 : _a.removeChild(this.proxySlot);
            }
            /**
             * Sets the validity of the custom element. By default this uses the proxy element to determine
             * validity, but this can be extended or replaced in implementation.
             */
            validate() {
                if (this.proxy instanceof HTMLElement) {
                    this.setValidity(this.proxy.validity, this.proxy.validationMessage);
                }
            }
            /**
             * Associates the provided value (and optional state) with the parent form.
             * @param value - The value to set
             * @param state - The state object provided to during session restores and when autofilling.
             */
            setFormValue(value, state) {
                if (this.elementInternals) {
                    this.elementInternals.setFormValue(value, state || value);
                }
            }
            _keypressHandler(e) {
                switch (e.key) {
                    case keyEnter:
                        if (this.form instanceof HTMLFormElement) {
                            // Implicit submission
                            const defaultButton = this.form.querySelector("[type=submit]");
                            defaultButton === null || defaultButton === void 0 ? void 0 : defaultButton.click();
                        }
                        break;
                }
            }
            /**
             * Used to stop propagation of proxy element events
             * @param e - Event object
             */
            stopPropagation(e) {
                e.stopPropagation();
            }
        };
        attr({ mode: "boolean" })(C.prototype, "disabled");
        attr({ mode: "fromView", attribute: "value" })(C.prototype, "initialValue");
        attr({ attribute: "current-value" })(C.prototype, "currentValue");
        attr(C.prototype, "name");
        attr({ mode: "boolean" })(C.prototype, "required");
        observable(C.prototype, "value");
        return C;
    }
    /**
     * @alpha
     */
    function CheckableFormAssociated(BaseCtor) {
        class C extends FormAssociated(BaseCtor) {
        }
        class D extends C {
            constructor(...args) {
                super(args);
                /**
                 * Tracks whether the "checked" property has been changed.
                 * This is necessary to provide consistent behavior with
                 * normal input checkboxes
                 */
                this.dirtyChecked = false;
                /**
                 * Provides the default checkedness of the input element
                 * Passed down to proxy
                 *
                 * @public
                 * @remarks
                 * HTML Attribute: checked
                 */
                this.checkedAttribute = false;
                /**
                 * The checked state of the control.
                 *
                 * @public
                 */
                this.checked = false;
                // Re-initialize dirtyChecked because initialization of other values
                // causes it to become true
                this.dirtyChecked = false;
            }
            checkedAttributeChanged() {
                this.defaultChecked = this.checkedAttribute;
            }
            /**
             * @internal
             */
            defaultCheckedChanged() {
                if (!this.dirtyChecked) {
                    // Setting this.checked will cause us to enter a dirty state,
                    // but if we are clean when defaultChecked is changed, we want to stay
                    // in a clean state, so reset this.dirtyChecked
                    this.checked = this.defaultChecked;
                    this.dirtyChecked = false;
                }
            }
            checkedChanged(prev, next) {
                if (!this.dirtyChecked) {
                    this.dirtyChecked = true;
                }
                this.currentChecked = this.checked;
                this.updateForm();
                if (this.proxy instanceof HTMLInputElement) {
                    this.proxy.checked = this.checked;
                }
                if (prev !== undefined) {
                    this.$emit("change");
                }
                this.validate();
            }
            currentCheckedChanged(prev, next) {
                this.checked = this.currentChecked;
            }
            updateForm() {
                const value = this.checked ? this.value : null;
                this.setFormValue(value, value);
            }
            connectedCallback() {
                super.connectedCallback();
                this.updateForm();
            }
            formResetCallback() {
                super.formResetCallback();
                this.checked = !!this.checkedAttribute;
                this.dirtyChecked = false;
            }
        }
        attr({ attribute: "checked", mode: "boolean" })(D.prototype, "checkedAttribute");
        attr({ attribute: "current-checked", converter: booleanConverter })(D.prototype, "currentChecked");
        observable(D.prototype, "defaultChecked");
        observable(D.prototype, "checked");
        return D;
    }

    class _Button extends FoundationElement {
    }
    /**
     * A form-associated base class for the {@link @microsoft/fast-foundation#(Button:class)} component.
     *
     * @internal
     */
    class FormAssociatedButton extends FormAssociated(_Button) {
        constructor() {
            super(...arguments);
            this.proxy = document.createElement("input");
        }
    }

    /**
     * A Button Custom HTML Element.
     * Based largely on the {@link https://developer.mozilla.org/en-US/docs/Web/HTML/Element/button | <button> element }.
     *
     * @public
     */
    class Button$1 extends FormAssociatedButton {
        constructor() {
            super(...arguments);
            /**
             * Prevent events to propagate if disabled and has no slotted content wrapped in HTML elements
             * @internal
             */
            this.handleClick = (e) => {
                var _a;
                if (this.disabled && ((_a = this.defaultSlottedContent) === null || _a === void 0 ? void 0 : _a.length) <= 1) {
                    e.stopPropagation();
                }
            };
            /**
             * Submits the parent form
             */
            this.handleSubmission = () => {
                if (!this.form) {
                    return;
                }
                const attached = this.proxy.isConnected;
                if (!attached) {
                    this.attachProxy();
                }
                // Browser support for requestSubmit is not comprehensive
                // so click the proxy if it isn't supported
                typeof this.form.requestSubmit === "function"
                    ? this.form.requestSubmit(this.proxy)
                    : this.proxy.click();
                if (!attached) {
                    this.detachProxy();
                }
            };
            /**
             * Resets the parent form
             */
            this.handleFormReset = () => {
                var _a;
                (_a = this.form) === null || _a === void 0 ? void 0 : _a.reset();
            };
            /**
             * Overrides the focus call for where delegatesFocus is unsupported.
             * This check works for Chrome, Edge Chromium, FireFox, and Safari
             * Relevant PR on the Firefox browser: https://phabricator.services.mozilla.com/D123858
             */
            this.handleUnsupportedDelegatesFocus = () => {
                var _a;
                // Check to see if delegatesFocus is supported
                if (window.ShadowRoot &&
                    !window.ShadowRoot.prototype.hasOwnProperty("delegatesFocus") && ((_a = this.$fastController.definition.shadowOptions) === null || _a === void 0 ? void 0 : _a.delegatesFocus)) {
                    this.focus = () => {
                        this.control.focus();
                    };
                }
            };
        }
        formactionChanged() {
            if (this.proxy instanceof HTMLInputElement) {
                this.proxy.formAction = this.formaction;
            }
        }
        formenctypeChanged() {
            if (this.proxy instanceof HTMLInputElement) {
                this.proxy.formEnctype = this.formenctype;
            }
        }
        formmethodChanged() {
            if (this.proxy instanceof HTMLInputElement) {
                this.proxy.formMethod = this.formmethod;
            }
        }
        formnovalidateChanged() {
            if (this.proxy instanceof HTMLInputElement) {
                this.proxy.formNoValidate = this.formnovalidate;
            }
        }
        formtargetChanged() {
            if (this.proxy instanceof HTMLInputElement) {
                this.proxy.formTarget = this.formtarget;
            }
        }
        typeChanged(previous, next) {
            if (this.proxy instanceof HTMLInputElement) {
                this.proxy.type = this.type;
            }
            next === "submit" && this.addEventListener("click", this.handleSubmission);
            previous === "submit" && this.removeEventListener("click", this.handleSubmission);
            next === "reset" && this.addEventListener("click", this.handleFormReset);
            previous === "reset" && this.removeEventListener("click", this.handleFormReset);
        }
        /**
         * @internal
         */
        connectedCallback() {
            var _a;
            super.connectedCallback();
            this.proxy.setAttribute("type", this.type);
            this.handleUnsupportedDelegatesFocus();
            const elements = Array.from((_a = this.control) === null || _a === void 0 ? void 0 : _a.children);
            if (elements) {
                elements.forEach((span) => {
                    span.addEventListener("click", this.handleClick);
                });
            }
        }
        /**
         * @internal
         */
        disconnectedCallback() {
            var _a;
            super.disconnectedCallback();
            const elements = Array.from((_a = this.control) === null || _a === void 0 ? void 0 : _a.children);
            if (elements) {
                elements.forEach((span) => {
                    span.removeEventListener("click", this.handleClick);
                });
            }
        }
    }
    __decorate$1([
        attr({ mode: "boolean" })
    ], Button$1.prototype, "autofocus", void 0);
    __decorate$1([
        attr({ attribute: "form" })
    ], Button$1.prototype, "formId", void 0);
    __decorate$1([
        attr
    ], Button$1.prototype, "formaction", void 0);
    __decorate$1([
        attr
    ], Button$1.prototype, "formenctype", void 0);
    __decorate$1([
        attr
    ], Button$1.prototype, "formmethod", void 0);
    __decorate$1([
        attr({ mode: "boolean" })
    ], Button$1.prototype, "formnovalidate", void 0);
    __decorate$1([
        attr
    ], Button$1.prototype, "formtarget", void 0);
    __decorate$1([
        attr
    ], Button$1.prototype, "type", void 0);
    __decorate$1([
        observable
    ], Button$1.prototype, "defaultSlottedContent", void 0);
    /**
     * Includes ARIA states and properties relating to the ARIA button role
     *
     * @public
     */
    class DelegatesARIAButton {
    }
    __decorate$1([
        attr({ attribute: "aria-expanded", mode: "fromView" })
    ], DelegatesARIAButton.prototype, "ariaExpanded", void 0);
    __decorate$1([
        attr({ attribute: "aria-pressed", mode: "fromView" })
    ], DelegatesARIAButton.prototype, "ariaPressed", void 0);
    applyMixins(DelegatesARIAButton, ARIAGlobalStatesAndProperties);
    applyMixins(Button$1, StartEnd, DelegatesARIAButton);

    /**
     * The template for the {@link @microsoft/fast-foundation#(Checkbox:class)} component.
     * @public
     */
    const checkboxTemplate = (context, definition) => html `
    <template
        role="checkbox"
        aria-checked="${x => x.checked}"
        aria-required="${x => x.required}"
        aria-disabled="${x => x.disabled}"
        aria-readonly="${x => x.readOnly}"
        tabindex="${x => (x.disabled ? null : 0)}"
        @keypress="${(x, c) => x.keypressHandler(c.event)}"
        @click="${(x, c) => x.clickHandler(c.event)}"
        class="${x => (x.readOnly ? "readonly" : "")} ${x => x.checked ? "checked" : ""} ${x => (x.indeterminate ? "indeterminate" : "")}"
    >
        <div part="control" class="control">
            <slot name="checked-indicator">
                ${definition.checkedIndicator || ""}
            </slot>
            <slot name="indeterminate-indicator">
                ${definition.indeterminateIndicator || ""}
            </slot>
        </div>
        <label
            part="label"
            class="${x => x.defaultSlottedNodes && x.defaultSlottedNodes.length
    ? "label"
    : "label label__hidden"}"
        >
            <slot ${slotted("defaultSlottedNodes")}></slot>
        </label>
    </template>
`;

    class _Checkbox extends FoundationElement {
    }
    /**
     * A form-associated base class for the {@link @microsoft/fast-foundation#(Checkbox:class)} component.
     *
     * @internal
     */
    class FormAssociatedCheckbox extends CheckableFormAssociated(_Checkbox) {
        constructor() {
            super(...arguments);
            this.proxy = document.createElement("input");
        }
    }

    /**
     * A Checkbox Custom HTML Element.
     * Implements the {@link https://www.w3.org/TR/wai-aria-1.1/#checkbox | ARIA checkbox }.
     *
     * @public
     */
    class Checkbox$1 extends FormAssociatedCheckbox {
        constructor() {
            super();
            /**
             * The element's value to be included in form submission when checked.
             * Default to "on" to reach parity with input[type="checkbox"]
             *
             * @internal
             */
            this.initialValue = "on";
            /**
             * The indeterminate state of the control
             */
            this.indeterminate = false;
            /**
             * @internal
             */
            this.keypressHandler = (e) => {
                switch (e.key) {
                    case keySpace:
                        this.checked = !this.checked;
                        break;
                }
            };
            /**
             * @internal
             */
            this.clickHandler = (e) => {
                if (!this.disabled && !this.readOnly) {
                    this.checked = !this.checked;
                }
            };
            this.proxy.setAttribute("type", "checkbox");
        }
        readOnlyChanged() {
            if (this.proxy instanceof HTMLInputElement) {
                this.proxy.readOnly = this.readOnly;
            }
        }
    }
    __decorate$1([
        attr({ attribute: "readonly", mode: "boolean" })
    ], Checkbox$1.prototype, "readOnly", void 0);
    __decorate$1([
        observable
    ], Checkbox$1.prototype, "defaultSlottedNodes", void 0);
    __decorate$1([
        observable
    ], Checkbox$1.prototype, "indeterminate", void 0);

    /**
     * Determines if the element is a {@link (ListboxOption:class)}
     *
     * @param element - the element to test.
     * @public
     */
    function isListboxOption(el) {
        return (isHTMLElement(el) &&
            (el.getAttribute("role") === "option" ||
                el instanceof HTMLOptionElement));
    }
    /**
     * An Option Custom HTML Element.
     * Implements {@link https://www.w3.org/TR/wai-aria-1.1/#option | ARIA option }.
     *
     * @public
     */
    class ListboxOption$1 extends FoundationElement {
        constructor(text, value, defaultSelected, selected) {
            super();
            /**
             * The defaultSelected state of the option.
             * @public
             */
            this.defaultSelected = false;
            /**
             * Tracks whether the "selected" property has been changed.
             * @internal
             */
            this.dirtySelected = false;
            /**
             * The checked state of the control.
             *
             * @public
             */
            this.selected = this.defaultSelected;
            /**
             * Track whether the value has been changed from the initial value
             */
            this.dirtyValue = false;
            if (text) {
                this.textContent = text;
            }
            if (value) {
                this.initialValue = value;
            }
            if (defaultSelected) {
                this.defaultSelected = defaultSelected;
            }
            if (selected) {
                this.selected = selected;
            }
            this.proxy = new Option(`${this.textContent}`, this.initialValue, this.defaultSelected, this.selected);
            this.proxy.disabled = this.disabled;
        }
        /**
         * Updates the ariaChecked property when the checked property changes.
         *
         * @param prev - the previous checked value
         * @param next - the current checked value
         *
         * @public
         */
        checkedChanged(prev, next) {
            if (typeof next === "boolean") {
                this.ariaChecked = next ? "true" : "false";
                return;
            }
            this.ariaChecked = undefined;
        }
        defaultSelectedChanged() {
            if (!this.dirtySelected) {
                this.selected = this.defaultSelected;
                if (this.proxy instanceof HTMLOptionElement) {
                    this.proxy.selected = this.defaultSelected;
                }
            }
        }
        disabledChanged(prev, next) {
            this.ariaDisabled = this.disabled ? "true" : "false";
            if (this.proxy instanceof HTMLOptionElement) {
                this.proxy.disabled = this.disabled;
            }
        }
        selectedAttributeChanged() {
            this.defaultSelected = this.selectedAttribute;
            if (this.proxy instanceof HTMLOptionElement) {
                this.proxy.defaultSelected = this.defaultSelected;
            }
        }
        selectedChanged() {
            this.ariaSelected = this.selected ? "true" : "false";
            if (!this.dirtySelected) {
                this.dirtySelected = true;
            }
            if (this.proxy instanceof HTMLOptionElement) {
                this.proxy.selected = this.selected;
            }
        }
        initialValueChanged(previous, next) {
            // If the value is clean and the component is connected to the DOM
            // then set value equal to the attribute value.
            if (!this.dirtyValue) {
                this.value = this.initialValue;
                this.dirtyValue = false;
            }
        }
        get label() {
            var _a, _b;
            return (_b = (_a = this.value) !== null && _a !== void 0 ? _a : this.textContent) !== null && _b !== void 0 ? _b : "";
        }
        get text() {
            return this.textContent;
        }
        set value(next) {
            this._value = next;
            this.dirtyValue = true;
            if (this.proxy instanceof HTMLElement) {
                this.proxy.value = next;
            }
            Observable.notify(this, "value");
        }
        get value() {
            var _a, _b;
            Observable.track(this, "value");
            return (_b = (_a = this._value) !== null && _a !== void 0 ? _a : this.textContent) !== null && _b !== void 0 ? _b : "";
        }
        get form() {
            return this.proxy ? this.proxy.form : null;
        }
    }
    __decorate$1([
        observable
    ], ListboxOption$1.prototype, "checked", void 0);
    __decorate$1([
        observable
    ], ListboxOption$1.prototype, "defaultSelected", void 0);
    __decorate$1([
        attr({ mode: "boolean" })
    ], ListboxOption$1.prototype, "disabled", void 0);
    __decorate$1([
        attr({ attribute: "selected", mode: "boolean" })
    ], ListboxOption$1.prototype, "selectedAttribute", void 0);
    __decorate$1([
        observable
    ], ListboxOption$1.prototype, "selected", void 0);
    __decorate$1([
        attr({ attribute: "value", mode: "fromView" })
    ], ListboxOption$1.prototype, "initialValue", void 0);
    /**
     * States and properties relating to the ARIA `option` role.
     *
     * @public
     */
    class DelegatesARIAListboxOption {
    }
    __decorate$1([
        observable
    ], DelegatesARIAListboxOption.prototype, "ariaChecked", void 0);
    __decorate$1([
        observable
    ], DelegatesARIAListboxOption.prototype, "ariaPosInSet", void 0);
    __decorate$1([
        observable
    ], DelegatesARIAListboxOption.prototype, "ariaSelected", void 0);
    __decorate$1([
        observable
    ], DelegatesARIAListboxOption.prototype, "ariaSetSize", void 0);
    applyMixins(DelegatesARIAListboxOption, ARIAGlobalStatesAndProperties);
    applyMixins(ListboxOption$1, StartEnd, DelegatesARIAListboxOption);

    /**
     * A Listbox Custom HTML Element.
     * Implements the {@link https://www.w3.org/TR/wai-aria-1.1/#listbox | ARIA listbox }.
     *
     * @public
     */
    class Listbox extends FoundationElement {
        constructor() {
            super(...arguments);
            /**
             * The internal unfiltered list of selectable options.
             *
             * @internal
             */
            this._options = [];
            /**
             * The index of the selected option.
             *
             * @public
             */
            this.selectedIndex = -1;
            /**
             * A collection of the selected options.
             *
             * @public
             */
            this.selectedOptions = [];
            /**
             * A standard `click` event creates a `focus` event before firing, so a
             * `mousedown` event is used to skip that initial focus.
             *
             * @internal
             */
            this.shouldSkipFocus = false;
            /**
             * The current typeahead buffer string.
             *
             * @internal
             */
            this.typeaheadBuffer = "";
            /**
             * Flag for the typeahead timeout expiration.
             *
             * @internal
             */
            this.typeaheadExpired = true;
            /**
             * The timeout ID for the typeahead handler.
             *
             * @internal
             */
            this.typeaheadTimeout = -1;
        }
        /**
         * The first selected option.
         *
         * @internal
         */
        get firstSelectedOption() {
            var _a;
            return (_a = this.selectedOptions[0]) !== null && _a !== void 0 ? _a : null;
        }
        /**
         * Returns true if there is one or more selectable option.
         *
         * @internal
         */
        get hasSelectableOptions() {
            return this.options.length > 0 && !this.options.every(o => o.disabled);
        }
        /**
         * The number of options.
         *
         * @public
         */
        get length() {
            var _a, _b;
            return (_b = (_a = this.options) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0;
        }
        /**
         * The list of options.
         *
         * @public
         */
        get options() {
            Observable.track(this, "options");
            return this._options;
        }
        set options(value) {
            this._options = value;
            Observable.notify(this, "options");
        }
        /**
         * Flag for the typeahead timeout expiration.
         *
         * @deprecated use `Listbox.typeaheadExpired`
         * @internal
         */
        get typeAheadExpired() {
            return this.typeaheadExpired;
        }
        set typeAheadExpired(value) {
            this.typeaheadExpired = value;
        }
        /**
         * Handle click events for listbox options.
         *
         * @internal
         */
        clickHandler(e) {
            const captured = e.target.closest(`option,[role=option]`);
            if (captured && !captured.disabled) {
                this.selectedIndex = this.options.indexOf(captured);
                return true;
            }
        }
        /**
         * Ensures that the provided option is focused and scrolled into view.
         *
         * @param optionToFocus - The option to focus
         * @internal
         */
        focusAndScrollOptionIntoView(optionToFocus = this.firstSelectedOption) {
            // To ensure that the browser handles both `focus()` and `scrollIntoView()`, the
            // timing here needs to guarantee that they happen on different frames. Since this
            // function is typically called from the `openChanged` observer, `DOM.queueUpdate`
            // causes the calls to be grouped into the same frame. To prevent this,
            // `requestAnimationFrame` is used instead of `DOM.queueUpdate`.
            if (this.contains(document.activeElement) && optionToFocus !== null) {
                optionToFocus.focus();
                requestAnimationFrame(() => {
                    optionToFocus.scrollIntoView({ block: "nearest" });
                });
            }
        }
        /**
         * Handles `focusin` actions for the component. When the component receives focus,
         * the list of selected options is refreshed and the first selected option is scrolled
         * into view.
         *
         * @internal
         */
        focusinHandler(e) {
            if (!this.shouldSkipFocus && e.target === e.currentTarget) {
                this.setSelectedOptions();
                this.focusAndScrollOptionIntoView();
            }
            this.shouldSkipFocus = false;
        }
        /**
         * Returns the options which match the current typeahead buffer.
         *
         * @internal
         */
        getTypeaheadMatches() {
            const pattern = this.typeaheadBuffer.replace(/[.*+\-?^${}()|[\]\\]/g, "\\$&");
            const re = new RegExp(`^${pattern}`, "gi");
            return this.options.filter((o) => o.text.trim().match(re));
        }
        /**
         * Determines the index of the next option which is selectable, if any.
         *
         * @param prev - the previous selected index
         * @param next - the next index to select
         *
         * @internal
         */
        getSelectableIndex(prev = this.selectedIndex, next) {
            const direction = prev > next ? -1 : prev < next ? 1 : 0;
            const potentialDirection = prev + direction;
            let nextSelectableOption = null;
            switch (direction) {
                case -1: {
                    nextSelectableOption = this.options.reduceRight((nextSelectableOption, thisOption, index) => !nextSelectableOption &&
                        !thisOption.disabled &&
                        index < potentialDirection
                        ? thisOption
                        : nextSelectableOption, nextSelectableOption);
                    break;
                }
                case 1: {
                    nextSelectableOption = this.options.reduce((nextSelectableOption, thisOption, index) => !nextSelectableOption &&
                        !thisOption.disabled &&
                        index > potentialDirection
                        ? thisOption
                        : nextSelectableOption, nextSelectableOption);
                    break;
                }
            }
            return this.options.indexOf(nextSelectableOption);
        }
        /**
         * Handles external changes to child options.
         *
         * @param source - the source object
         * @param propertyName - the property
         *
         * @internal
         */
        handleChange(source, propertyName) {
            switch (propertyName) {
                case "selected": {
                    if (Listbox.slottedOptionFilter(source)) {
                        this.selectedIndex = this.options.indexOf(source);
                    }
                    this.setSelectedOptions();
                    break;
                }
            }
        }
        /**
         * Moves focus to an option whose label matches characters typed by the user.
         * Consecutive keystrokes are batched into a buffer of search text used
         * to match against the set of options.  If `TYPE_AHEAD_TIMEOUT_MS` passes
         * between consecutive keystrokes, the search restarts.
         *
         * @param key - the key to be evaluated
         *
         * @internal
         */
        handleTypeAhead(key) {
            if (this.typeaheadTimeout) {
                window.clearTimeout(this.typeaheadTimeout);
            }
            this.typeaheadTimeout = window.setTimeout(() => (this.typeaheadExpired = true), Listbox.TYPE_AHEAD_TIMEOUT_MS);
            if (key.length > 1) {
                return;
            }
            this.typeaheadBuffer = `${this.typeaheadExpired ? "" : this.typeaheadBuffer}${key}`;
        }
        /**
         * Handles `keydown` actions for listbox navigation and typeahead.
         *
         * @internal
         */
        keydownHandler(e) {
            if (this.disabled) {
                return true;
            }
            this.shouldSkipFocus = false;
            const key = e.key;
            switch (key) {
                // Select the first available option
                case keyHome: {
                    if (!e.shiftKey) {
                        e.preventDefault();
                        this.selectFirstOption();
                    }
                    break;
                }
                // Select the next selectable option
                case keyArrowDown: {
                    if (!e.shiftKey) {
                        e.preventDefault();
                        this.selectNextOption();
                    }
                    break;
                }
                // Select the previous selectable option
                case keyArrowUp: {
                    if (!e.shiftKey) {
                        e.preventDefault();
                        this.selectPreviousOption();
                    }
                    break;
                }
                // Select the last available option
                case keyEnd: {
                    e.preventDefault();
                    this.selectLastOption();
                    break;
                }
                case keyTab: {
                    this.focusAndScrollOptionIntoView();
                    return true;
                }
                case keyEnter:
                case keyEscape: {
                    return true;
                }
                case keySpace: {
                    if (this.typeaheadExpired) {
                        return true;
                    }
                }
                // Send key to Typeahead handler
                default: {
                    if (key.length === 1) {
                        this.handleTypeAhead(`${key}`);
                    }
                    return true;
                }
            }
        }
        /**
         * Prevents `focusin` events from firing before `click` events when the
         * element is unfocused.
         *
         * @internal
         */
        mousedownHandler(e) {
            this.shouldSkipFocus = !this.contains(document.activeElement);
            return true;
        }
        /**
         * Switches between single-selection and multi-selection mode.
         *
         * @param prev - the previous value of the `multiple` attribute
         * @param next - the next value of the `multiple` attribute
         *
         * @internal
         */
        multipleChanged(prev, next) {
            this.ariaMultiSelectable = next ? "true" : undefined;
        }
        /**
         * Updates the list of selected options when the `selectedIndex` changes.
         *
         * @param prev - the previous selected index value
         * @param next - the current selected index value
         *
         * @internal
         */
        selectedIndexChanged(prev, next) {
            var _a;
            if (!this.hasSelectableOptions) {
                this.selectedIndex = -1;
                return;
            }
            if (((_a = this.options[this.selectedIndex]) === null || _a === void 0 ? void 0 : _a.disabled) && typeof prev === "number") {
                const selectableIndex = this.getSelectableIndex(prev, next);
                const newNext = selectableIndex > -1 ? selectableIndex : prev;
                this.selectedIndex = newNext;
                if (next === newNext) {
                    this.selectedIndexChanged(next, newNext);
                }
                return;
            }
            this.setSelectedOptions();
        }
        /**
         * Updates the selectedness of each option when the list of selected options changes.
         *
         * @param prev - the previous list of selected options
         * @param next - the current list of selected options
         *
         * @internal
         */
        selectedOptionsChanged(prev, next) {
            var _a;
            const filteredNext = next.filter(Listbox.slottedOptionFilter);
            (_a = this.options) === null || _a === void 0 ? void 0 : _a.forEach(o => {
                const notifier = Observable.getNotifier(o);
                notifier.unsubscribe(this, "selected");
                o.selected = filteredNext.includes(o);
                notifier.subscribe(this, "selected");
            });
        }
        /**
         * Moves focus to the first selectable option.
         *
         * @public
         */
        selectFirstOption() {
            var _a, _b;
            if (!this.disabled) {
                this.selectedIndex = (_b = (_a = this.options) === null || _a === void 0 ? void 0 : _a.findIndex(o => !o.disabled)) !== null && _b !== void 0 ? _b : -1;
            }
        }
        /**
         * Moves focus to the last selectable option.
         *
         * @internal
         */
        selectLastOption() {
            if (!this.disabled) {
                this.selectedIndex = findLastIndex(this.options, o => !o.disabled);
            }
        }
        /**
         * Moves focus to the next selectable option.
         *
         * @internal
         */
        selectNextOption() {
            if (!this.disabled && this.selectedIndex < this.options.length - 1) {
                this.selectedIndex += 1;
            }
        }
        /**
         * Moves focus to the previous selectable option.
         *
         * @internal
         */
        selectPreviousOption() {
            if (!this.disabled && this.selectedIndex > 0) {
                this.selectedIndex = this.selectedIndex - 1;
            }
        }
        /**
         * Updates the selected index to match the first selected option.
         *
         * @internal
         */
        setDefaultSelectedOption() {
            var _a, _b;
            this.selectedIndex = (_b = (_a = this.options) === null || _a === void 0 ? void 0 : _a.findIndex(el => el.defaultSelected)) !== null && _b !== void 0 ? _b : -1;
        }
        /**
         * Sets an option as selected and gives it focus.
         *
         * @public
         */
        setSelectedOptions() {
            var _a, _b, _c;
            if ((_a = this.options) === null || _a === void 0 ? void 0 : _a.length) {
                this.selectedOptions = [this.options[this.selectedIndex]];
                this.ariaActiveDescendant = (_c = (_b = this.firstSelectedOption) === null || _b === void 0 ? void 0 : _b.id) !== null && _c !== void 0 ? _c : "";
                this.focusAndScrollOptionIntoView();
            }
        }
        /**
         * Updates the list of options and resets the selected option when the slotted option content changes.
         *
         * @param prev - the previous list of slotted options
         * @param next - the current list of slotted options
         *
         * @internal
         */
        slottedOptionsChanged(prev, next) {
            this.options = next.reduce((options, item) => {
                if (isListboxOption(item)) {
                    options.push(item);
                }
                return options;
            }, []);
            const setSize = `${this.options.length}`;
            this.options.forEach((option, index) => {
                if (!option.id) {
                    option.id = uniqueId("option-");
                }
                option.ariaPosInSet = `${index + 1}`;
                option.ariaSetSize = setSize;
            });
            if (this.$fastController.isConnected) {
                this.setSelectedOptions();
                this.setDefaultSelectedOption();
            }
        }
        /**
         * Updates the filtered list of options when the typeahead buffer changes.
         *
         * @param prev - the previous typeahead buffer value
         * @param next - the current typeahead buffer value
         *
         * @internal
         */
        typeaheadBufferChanged(prev, next) {
            if (this.$fastController.isConnected) {
                const typeaheadMatches = this.getTypeaheadMatches();
                if (typeaheadMatches.length) {
                    const selectedIndex = this.options.indexOf(typeaheadMatches[0]);
                    if (selectedIndex > -1) {
                        this.selectedIndex = selectedIndex;
                    }
                }
                this.typeaheadExpired = false;
            }
        }
    }
    /**
     * A static filter to include only selectable options.
     *
     * @param n - element to filter
     * @public
     */
    Listbox.slottedOptionFilter = (n) => isListboxOption(n) && !n.disabled && !n.hidden;
    /**
     * Typeahead timeout in milliseconds.
     *
     * @internal
     */
    Listbox.TYPE_AHEAD_TIMEOUT_MS = 1000;
    __decorate$1([
        attr({ mode: "boolean" })
    ], Listbox.prototype, "disabled", void 0);
    __decorate$1([
        attr({ mode: "boolean" })
    ], Listbox.prototype, "multiple", void 0);
    __decorate$1([
        observable
    ], Listbox.prototype, "selectedIndex", void 0);
    __decorate$1([
        observable
    ], Listbox.prototype, "selectedOptions", void 0);
    __decorate$1([
        observable
    ], Listbox.prototype, "slottedOptions", void 0);
    __decorate$1([
        observable
    ], Listbox.prototype, "typeaheadBuffer", void 0);
    /**
     * Includes ARIA states and properties relating to the ARIA listbox role
     *
     * @public
     */
    class DelegatesARIAListbox {
    }
    __decorate$1([
        observable
    ], DelegatesARIAListbox.prototype, "ariaActiveDescendant", void 0);
    __decorate$1([
        observable
    ], DelegatesARIAListbox.prototype, "ariaDisabled", void 0);
    __decorate$1([
        observable
    ], DelegatesARIAListbox.prototype, "ariaExpanded", void 0);
    __decorate$1([
        observable
    ], DelegatesARIAListbox.prototype, "ariaMultiSelectable", void 0);
    applyMixins(DelegatesARIAListbox, ARIAGlobalStatesAndProperties);
    applyMixins(Listbox, DelegatesARIAListbox);

    /**
     * Positioning directions for the listbox when a select is open.
     * @public
     */
    var SelectPosition;
    (function (SelectPosition) {
        SelectPosition["above"] = "above";
        SelectPosition["below"] = "below";
    })(SelectPosition || (SelectPosition = {}));

    /**
     * Retrieves the "composed parent" element of a node, ignoring DOM tree boundaries.
     * When the parent of a node is a shadow-root, it will return the host
     * element of the shadow root. Otherwise it will return the parent node or null if
     * no parent node exists.
     * @param element - The element for which to retrieve the composed parent
     *
     * @public
     */
    function composedParent(element) {
        const parentNode = element.parentElement;
        if (parentNode) {
            return parentNode;
        }
        else {
            const rootNode = element.getRootNode();
            if (rootNode.host instanceof HTMLElement) {
                // this is shadow-root
                return rootNode.host;
            }
        }
        return null;
    }

    /**
     * Determines if the reference element contains the test element in a "composed" DOM tree that
     * ignores shadow DOM boundaries.
     *
     * Returns true of the test element is a descendent of the reference, or exist in
     * a shadow DOM that is a logical descendent of the reference. Otherwise returns false.
     * @param reference - The element to test for containment against.
     * @param test - The element being tested for containment.
     *
     * @public
     */
    function composedContains(reference, test) {
        let current = test;
        while (current !== null) {
            if (current === reference) {
                return true;
            }
            current = composedParent(current);
        }
        return false;
    }

    /**
     * A behavior to add or remove a stylesheet from an element based on a property. The behavior ensures that
     * styles are applied while the property matches and that styles are not applied if the property does
     * not match.
     *
     * @public
     */
    class PropertyStyleSheetBehavior {
        /**
         * Constructs a {@link PropertyStyleSheetBehavior} instance.
         * @param propertyName - The property name to operate from.
         * @param value - The property value to operate from.
         * @param styles - The styles to coordinate with the property.
         */
        constructor(propertyName, value, styles) {
            this.propertyName = propertyName;
            this.value = value;
            this.styles = styles;
        }
        /**
         * Binds the behavior to the element.
         * @param elementInstance - The element for which the property is applied.
         */
        bind(elementInstance) {
            Observable.getNotifier(elementInstance).subscribe(this, this.propertyName);
            this.handleChange(elementInstance, this.propertyName);
        }
        /**
         * Unbinds the behavior from the element.
         * @param source - The element for which the behavior is unbinding.
         * @internal
         */
        unbind(source) {
            Observable.getNotifier(source).unsubscribe(this, this.propertyName);
            source.$fastController.removeStyles(this.styles);
        }
        /**
         * Change event for the provided element.
         * @param source - the element for which to attach or detach styles.
         * @param key - the key to lookup to know if the element already has the styles
         * @internal
         */
        handleChange(source, key) {
            if (source[key] === this.value) {
                source.$fastController.addStyles(this.styles);
            }
            else {
                source.$fastController.removeStyles(this.styles);
            }
        }
    }

    /**
     * A CSS fragment to set `display: none;` when the host is hidden using the [hidden] attribute.
     * @public
     */
    const hidden = `:host([hidden]){display:none}`;
    /**
     * Applies a CSS display property.
     * Also adds CSS rules to not display the element when the [hidden] attribute is applied to the element.
     * @param display - The CSS display property value
     * @public
     */
    function display(displayValue) {
        return `${hidden}:host{display:${displayValue}}`;
    }

    /**
     * The string representing the focus selector to be used. Value
     * will be "focus-visible" when https://drafts.csswg.org/selectors-4/#the-focus-visible-pseudo
     * is supported and "focus" when it is not.
     *
     * @public
     */
    const focusVisible$1 = canUseFocusVisible() ? "focus-visible" : "focus";

    /**
     * a method to filter out any whitespace _only_ nodes, to be used inside a template
     * @param value - The Node that is being inspected
     * @param index - The index of the node within the array
     * @param array - The Node array that is being filtered
     *
     * @public
     */
    function whitespaceFilter(value, index, array) {
        return value.nodeType !== Node.TEXT_NODE
            ? true
            : typeof value.nodeValue === "string" && !!value.nodeValue.trim().length;
    }

    const defaultElement = document.createElement("div");
    function isFastElement(element) {
        return element instanceof FASTElement;
    }
    class QueuedStyleSheetTarget {
        setProperty(name, value) {
            DOM.queueUpdate(() => this.target.setProperty(name, value));
        }
        removeProperty(name) {
            DOM.queueUpdate(() => this.target.removeProperty(name));
        }
    }
    /**
     * Handles setting properties for a FASTElement using Constructable Stylesheets
     */
    class ConstructableStyleSheetTarget extends QueuedStyleSheetTarget {
        constructor(source) {
            super();
            const sheet = new CSSStyleSheet();
            this.target = sheet.cssRules[sheet.insertRule(":host{}")].style;
            source.$fastController.addStyles(ElementStyles.create([sheet]));
        }
    }
    class DocumentStyleSheetTarget extends QueuedStyleSheetTarget {
        constructor() {
            super();
            const sheet = new CSSStyleSheet();
            this.target = sheet.cssRules[sheet.insertRule(":root{}")].style;
            document.adoptedStyleSheets = [
                ...document.adoptedStyleSheets,
                sheet,
            ];
        }
    }
    class HeadStyleElementStyleSheetTarget extends QueuedStyleSheetTarget {
        constructor() {
            super();
            this.style = document.createElement("style");
            document.head.appendChild(this.style);
            const { sheet } = this.style;
            // Because the HTMLStyleElement has been appended,
            // there shouldn't exist a case where `sheet` is null,
            // but if-check it just in case.
            if (sheet) {
                // https://github.com/jsdom/jsdom uses https://github.com/NV/CSSOM for it's CSSOM implementation,
                // which implements the DOM Level 2 spec for CSSStyleSheet where insertRule() requires an index argument.
                const index = sheet.insertRule(":root{}", sheet.cssRules.length);
                this.target = sheet.cssRules[index].style;
            }
        }
    }
    /**
     * Handles setting properties for a FASTElement using an HTMLStyleElement
     */
    class StyleElementStyleSheetTarget {
        constructor(target) {
            this.store = new Map();
            this.target = null;
            const controller = target.$fastController;
            this.style = document.createElement("style");
            controller.addStyles(this.style);
            Observable.getNotifier(controller).subscribe(this, "isConnected");
            this.handleChange(controller, "isConnected");
        }
        targetChanged() {
            if (this.target !== null) {
                for (const [key, value] of this.store.entries()) {
                    this.target.setProperty(key, value);
                }
            }
        }
        setProperty(name, value) {
            this.store.set(name, value);
            DOM.queueUpdate(() => {
                if (this.target !== null) {
                    this.target.setProperty(name, value);
                }
            });
        }
        removeProperty(name) {
            this.store.delete(name);
            DOM.queueUpdate(() => {
                if (this.target !== null) {
                    this.target.removeProperty(name);
                }
            });
        }
        handleChange(source, key) {
            // HTMLStyleElement.sheet is null if the element isn't connected to the DOM,
            // so this method reacts to changes in DOM connection for the element hosting
            // the HTMLStyleElement.
            //
            // All rules applied via the CSSOM also get cleared when the element disconnects,
            // so we need to add a new rule each time and populate it with the stored properties
            const { sheet } = this.style;
            if (sheet) {
                // Safari will throw if we try to use the return result of insertRule()
                // to index the rule inline, so store as a const prior to indexing.
                // https://github.com/jsdom/jsdom uses https://github.com/NV/CSSOM for it's CSSOM implementation,
                // which implements the DOM Level 2 spec for CSSStyleSheet where insertRule() requires an index argument.
                const index = sheet.insertRule(":host{}", sheet.cssRules.length);
                this.target = sheet.cssRules[index].style;
            }
            else {
                this.target = null;
            }
        }
    }
    __decorate$1([
        observable
    ], StyleElementStyleSheetTarget.prototype, "target", void 0);
    /**
     * Handles setting properties for a normal HTMLElement
     */
    class ElementStyleSheetTarget {
        constructor(source) {
            this.target = source.style;
        }
        setProperty(name, value) {
            DOM.queueUpdate(() => this.target.setProperty(name, value));
        }
        removeProperty(name) {
            DOM.queueUpdate(() => this.target.removeProperty(name));
        }
    }
    /**
     * Controls emission for default values. This control is capable
     * of emitting to multiple {@link PropertyTarget | PropertyTargets},
     * and only emits if it has at least one root.
     *
     * @internal
     */
    class RootStyleSheetTarget {
        setProperty(name, value) {
            RootStyleSheetTarget.properties[name] = value;
            for (const target of RootStyleSheetTarget.roots.values()) {
                PropertyTargetManager.getOrCreate(RootStyleSheetTarget.normalizeRoot(target)).setProperty(name, value);
            }
        }
        removeProperty(name) {
            delete RootStyleSheetTarget.properties[name];
            for (const target of RootStyleSheetTarget.roots.values()) {
                PropertyTargetManager.getOrCreate(RootStyleSheetTarget.normalizeRoot(target)).removeProperty(name);
            }
        }
        static registerRoot(root) {
            const { roots } = RootStyleSheetTarget;
            if (!roots.has(root)) {
                roots.add(root);
                const target = PropertyTargetManager.getOrCreate(this.normalizeRoot(root));
                for (const key in RootStyleSheetTarget.properties) {
                    target.setProperty(key, RootStyleSheetTarget.properties[key]);
                }
            }
        }
        static unregisterRoot(root) {
            const { roots } = RootStyleSheetTarget;
            if (roots.has(root)) {
                roots.delete(root);
                const target = PropertyTargetManager.getOrCreate(RootStyleSheetTarget.normalizeRoot(root));
                for (const key in RootStyleSheetTarget.properties) {
                    target.removeProperty(key);
                }
            }
        }
        /**
         * Returns the document when provided the default element,
         * otherwise is a no-op
         * @param root - the root to normalize
         */
        static normalizeRoot(root) {
            return root === defaultElement ? document : root;
        }
    }
    RootStyleSheetTarget.roots = new Set();
    RootStyleSheetTarget.properties = {};
    // Caches PropertyTarget instances
    const propertyTargetCache = new WeakMap();
    // Use Constructable StyleSheets for FAST elements when supported, otherwise use
    // HTMLStyleElement instances
    const propertyTargetCtor = DOM.supportsAdoptedStyleSheets
        ? ConstructableStyleSheetTarget
        : StyleElementStyleSheetTarget;
    /**
     * Manages creation and caching of PropertyTarget instances.
     *
     * @internal
     */
    const PropertyTargetManager = Object.freeze({
        getOrCreate(source) {
            if (propertyTargetCache.has(source)) {
                /* eslint-disable-next-line @typescript-eslint/no-non-null-assertion */
                return propertyTargetCache.get(source);
            }
            let target;
            if (source === defaultElement) {
                target = new RootStyleSheetTarget();
            }
            else if (source instanceof Document) {
                target = DOM.supportsAdoptedStyleSheets
                    ? new DocumentStyleSheetTarget()
                    : new HeadStyleElementStyleSheetTarget();
            }
            else if (isFastElement(source)) {
                target = new propertyTargetCtor(source);
            }
            else {
                target = new ElementStyleSheetTarget(source);
            }
            propertyTargetCache.set(source, target);
            return target;
        },
    });

    /**
     * Implementation of {@link (DesignToken:interface)}
     */
    class DesignTokenImpl extends CSSDirective {
        constructor(configuration) {
            super();
            this.subscribers = new WeakMap();
            this._appliedTo = new Set();
            this.name = configuration.name;
            if (configuration.cssCustomPropertyName !== null) {
                this.cssCustomProperty = `--${configuration.cssCustomPropertyName}`;
                this.cssVar = `var(${this.cssCustomProperty})`;
            }
            this.id = DesignTokenImpl.uniqueId();
            DesignTokenImpl.tokensById.set(this.id, this);
        }
        get appliedTo() {
            return [...this._appliedTo];
        }
        static from(nameOrConfig) {
            return new DesignTokenImpl({
                name: typeof nameOrConfig === "string" ? nameOrConfig : nameOrConfig.name,
                cssCustomPropertyName: typeof nameOrConfig === "string"
                    ? nameOrConfig
                    : nameOrConfig.cssCustomPropertyName === void 0
                        ? nameOrConfig.name
                        : nameOrConfig.cssCustomPropertyName,
            });
        }
        static isCSSDesignToken(token) {
            return typeof token.cssCustomProperty === "string";
        }
        static isDerivedDesignTokenValue(value) {
            return typeof value === "function";
        }
        /**
         * Gets a token by ID. Returns undefined if the token was not found.
         * @param id - The ID of the token
         * @returns
         */
        static getTokenById(id) {
            return DesignTokenImpl.tokensById.get(id);
        }
        getOrCreateSubscriberSet(target = this) {
            return (this.subscribers.get(target) ||
                (this.subscribers.set(target, new Set()) && this.subscribers.get(target)));
        }
        createCSS() {
            return this.cssVar || "";
        }
        getValueFor(element) {
            const value = DesignTokenNode.getOrCreate(element).get(this);
            if (value !== undefined) {
                return value;
            }
            throw new Error(`Value could not be retrieved for token named "${this.name}". Ensure the value is set for ${element} or an ancestor of ${element}.`);
        }
        setValueFor(element, value) {
            this._appliedTo.add(element);
            if (value instanceof DesignTokenImpl) {
                value = this.alias(value);
            }
            DesignTokenNode.getOrCreate(element).set(this, value);
            return this;
        }
        deleteValueFor(element) {
            this._appliedTo.delete(element);
            if (DesignTokenNode.existsFor(element)) {
                DesignTokenNode.getOrCreate(element).delete(this);
            }
            return this;
        }
        withDefault(value) {
            this.setValueFor(defaultElement, value);
            return this;
        }
        subscribe(subscriber, target) {
            const subscriberSet = this.getOrCreateSubscriberSet(target);
            if (target && !DesignTokenNode.existsFor(target)) {
                DesignTokenNode.getOrCreate(target);
            }
            if (!subscriberSet.has(subscriber)) {
                subscriberSet.add(subscriber);
            }
        }
        unsubscribe(subscriber, target) {
            const list = this.subscribers.get(target || this);
            if (list && list.has(subscriber)) {
                list.delete(subscriber);
            }
        }
        /**
         * Notifies subscribers that the value for an element has changed.
         * @param element - The element to emit a notification for
         */
        notify(element) {
            const record = Object.freeze({ token: this, target: element });
            if (this.subscribers.has(this)) {
                this.subscribers.get(this).forEach(sub => sub.handleChange(record));
            }
            if (this.subscribers.has(element)) {
                this.subscribers.get(element).forEach(sub => sub.handleChange(record));
            }
        }
        /**
         * Alias the token to the provided token.
         * @param token - the token to alias to
         */
        alias(token) {
            return ((target) => token.getValueFor(target));
        }
    }
    DesignTokenImpl.uniqueId = (() => {
        let id = 0;
        return () => {
            id++;
            return id.toString(16);
        };
    })();
    /**
     * Token storage by token ID
     */
    DesignTokenImpl.tokensById = new Map();
    class CustomPropertyReflector {
        startReflection(token, target) {
            token.subscribe(this, target);
            this.handleChange({ token, target });
        }
        stopReflection(token, target) {
            token.unsubscribe(this, target);
            this.remove(token, target);
        }
        handleChange(record) {
            const { token, target } = record;
            this.add(token, target);
        }
        add(token, target) {
            PropertyTargetManager.getOrCreate(target).setProperty(token.cssCustomProperty, this.resolveCSSValue(DesignTokenNode.getOrCreate(target).get(token)));
        }
        remove(token, target) {
            PropertyTargetManager.getOrCreate(target).removeProperty(token.cssCustomProperty);
        }
        resolveCSSValue(value) {
            return value && typeof value.createCSS === "function" ? value.createCSS() : value;
        }
    }
    /**
     * A light wrapper around BindingObserver to handle value caching and
     * token notification
     */
    class DesignTokenBindingObserver {
        constructor(source, token, node) {
            this.source = source;
            this.token = token;
            this.node = node;
            this.dependencies = new Set();
            this.observer = Observable.binding(source, this, false);
            // This is a little bit hacky because it's using internal APIs of BindingObserverImpl.
            // BindingObserverImpl queues updates to batch it's notifications which doesn't work for this
            // scenario because the DesignToken.getValueFor API is not async. Without this, using DesignToken.getValueFor()
            // after DesignToken.setValueFor() when setting a dependency of the value being retrieved can return a stale
            // value. Assigning .handleChange to .call forces immediate invocation of this classes handleChange() method,
            // allowing resolution of values synchronously.
            // TODO: https://github.com/microsoft/fast/issues/5110
            this.observer.handleChange = this.observer.call;
            this.handleChange();
        }
        disconnect() {
            this.observer.disconnect();
        }
        /**
         * @internal
         */
        handleChange() {
            this.node.store.set(this.token, this.observer.observe(this.node.target, defaultExecutionContext));
        }
    }
    /**
     * Stores resolved token/value pairs and notifies on changes
     */
    class Store {
        constructor() {
            this.values = new Map();
        }
        set(token, value) {
            if (this.values.get(token) !== value) {
                this.values.set(token, value);
                Observable.getNotifier(this).notify(token.id);
            }
        }
        get(token) {
            Observable.track(this, token.id);
            return this.values.get(token);
        }
        delete(token) {
            this.values.delete(token);
        }
        all() {
            return this.values.entries();
        }
    }
    const nodeCache = new WeakMap();
    const childToParent = new WeakMap();
    /**
     * A node responsible for setting and getting token values,
     * emitting values to CSS custom properties, and maintaining
     * inheritance structures.
     */
    class DesignTokenNode {
        constructor(target) {
            this.target = target;
            /**
             * Stores all resolved token values for a node
             */
            this.store = new Store();
            /**
             * All children assigned to the node
             */
            this.children = [];
            /**
             * All values explicitly assigned to the node in their raw form
             */
            this.assignedValues = new Map();
            /**
             * Tokens currently being reflected to CSS custom properties
             */
            this.reflecting = new Set();
            /**
             * Binding observers for assigned and inherited derived values.
             */
            this.bindingObservers = new Map();
            /**
             * Emits notifications to token when token values
             * change the DesignTokenNode
             */
            this.tokenValueChangeHandler = {
                handleChange: (source, arg) => {
                    const token = DesignTokenImpl.getTokenById(arg);
                    if (token) {
                        // Notify any token subscribers
                        token.notify(this.target);
                        if (DesignTokenImpl.isCSSDesignToken(token)) {
                            const parent = this.parent;
                            const reflecting = this.isReflecting(token);
                            if (parent) {
                                const parentValue = parent.get(token);
                                const sourceValue = source.get(token);
                                if (parentValue !== sourceValue && !reflecting) {
                                    this.reflectToCSS(token);
                                }
                                else if (parentValue === sourceValue && reflecting) {
                                    this.stopReflectToCSS(token);
                                }
                            }
                            else if (!reflecting) {
                                this.reflectToCSS(token);
                            }
                        }
                    }
                },
            };
            nodeCache.set(target, this);
            // Map store change notifications to token change notifications
            Observable.getNotifier(this.store).subscribe(this.tokenValueChangeHandler);
            if (target instanceof FASTElement) {
                target.$fastController.addBehaviors([this]);
            }
            else if (target.isConnected) {
                this.bind();
            }
        }
        /**
         * Returns a DesignTokenNode for an element.
         * Creates a new instance if one does not already exist for a node,
         * otherwise returns the cached instance
         *
         * @param target - The HTML element to retrieve a DesignTokenNode for
         */
        static getOrCreate(target) {
            return nodeCache.get(target) || new DesignTokenNode(target);
        }
        /**
         * Determines if a DesignTokenNode has been created for a target
         * @param target - The element to test
         */
        static existsFor(target) {
            return nodeCache.has(target);
        }
        /**
         * Searches for and return the nearest parent DesignTokenNode.
         * Null is returned if no node is found or the node provided is for a default element.
         */
        static findParent(node) {
            if (!(defaultElement === node.target)) {
                let parent = composedParent(node.target);
                while (parent !== null) {
                    if (nodeCache.has(parent)) {
                        return nodeCache.get(parent);
                    }
                    parent = composedParent(parent);
                }
                return DesignTokenNode.getOrCreate(defaultElement);
            }
            return null;
        }
        /**
         * Finds the closest node with a value explicitly assigned for a token, otherwise null.
         * @param token - The token to look for
         * @param start - The node to start looking for value assignment
         * @returns
         */
        static findClosestAssignedNode(token, start) {
            let current = start;
            do {
                if (current.has(token)) {
                    return current;
                }
                current = current.parent
                    ? current.parent
                    : current.target !== defaultElement
                        ? DesignTokenNode.getOrCreate(defaultElement)
                        : null;
            } while (current !== null);
            return null;
        }
        /**
         * The parent DesignTokenNode, or null.
         */
        get parent() {
            return childToParent.get(this) || null;
        }
        /**
         * Checks if a token has been assigned an explicit value the node.
         * @param token - the token to check.
         */
        has(token) {
            return this.assignedValues.has(token);
        }
        /**
         * Gets the value of a token for a node
         * @param token - The token to retrieve the value for
         * @returns
         */
        get(token) {
            const value = this.store.get(token);
            if (value !== undefined) {
                return value;
            }
            const raw = this.getRaw(token);
            if (raw !== undefined) {
                this.hydrate(token, raw);
                return this.get(token);
            }
        }
        /**
         * Retrieves the raw assigned value of a token from the nearest assigned node.
         * @param token - The token to retrieve a raw value for
         * @returns
         */
        getRaw(token) {
            var _a;
            if (this.assignedValues.has(token)) {
                return this.assignedValues.get(token);
            }
            return (_a = DesignTokenNode.findClosestAssignedNode(token, this)) === null || _a === void 0 ? void 0 : _a.getRaw(token);
        }
        /**
         * Sets a token to a value for a node
         * @param token - The token to set
         * @param value - The value to set the token to
         */
        set(token, value) {
            if (DesignTokenImpl.isDerivedDesignTokenValue(this.assignedValues.get(token))) {
                this.tearDownBindingObserver(token);
            }
            this.assignedValues.set(token, value);
            if (DesignTokenImpl.isDerivedDesignTokenValue(value)) {
                this.setupBindingObserver(token, value);
            }
            else {
                this.store.set(token, value);
            }
        }
        /**
         * Deletes a token value for the node.
         * @param token - The token to delete the value for
         */
        delete(token) {
            this.assignedValues.delete(token);
            this.tearDownBindingObserver(token);
            const upstream = this.getRaw(token);
            if (upstream) {
                this.hydrate(token, upstream);
            }
            else {
                this.store.delete(token);
            }
        }
        /**
         * Invoked when the DesignTokenNode.target is attached to the document
         */
        bind() {
            const parent = DesignTokenNode.findParent(this);
            if (parent) {
                parent.appendChild(this);
            }
            for (const key of this.assignedValues.keys()) {
                key.notify(this.target);
            }
        }
        /**
         * Invoked when the DesignTokenNode.target is detached from the document
         */
        unbind() {
            if (this.parent) {
                const parent = childToParent.get(this);
                parent.removeChild(this);
            }
        }
        /**
         * Appends a child to a parent DesignTokenNode.
         * @param child - The child to append to the node
         */
        appendChild(child) {
            if (child.parent) {
                childToParent.get(child).removeChild(child);
            }
            const reParent = this.children.filter(x => child.contains(x));
            childToParent.set(child, this);
            this.children.push(child);
            reParent.forEach(x => child.appendChild(x));
            Observable.getNotifier(this.store).subscribe(child);
            // How can we not notify *every* subscriber?
            for (const [token, value] of this.store.all()) {
                child.hydrate(token, this.bindingObservers.has(token) ? this.getRaw(token) : value);
            }
        }
        /**
         * Removes a child from a node.
         * @param child - The child to remove.
         */
        removeChild(child) {
            const childIndex = this.children.indexOf(child);
            if (childIndex !== -1) {
                this.children.splice(childIndex, 1);
            }
            Observable.getNotifier(this.store).unsubscribe(child);
            return child.parent === this ? childToParent.delete(child) : false;
        }
        /**
         * Tests whether a provided node is contained by
         * the calling node.
         * @param test - The node to test
         */
        contains(test) {
            return composedContains(this.target, test.target);
        }
        /**
         * Instructs the node to reflect a design token for the provided token.
         * @param token - The design token to reflect
         */
        reflectToCSS(token) {
            if (!this.isReflecting(token)) {
                this.reflecting.add(token);
                DesignTokenNode.cssCustomPropertyReflector.startReflection(token, this.target);
            }
        }
        /**
         * Stops reflecting a DesignToken to CSS
         * @param token - The design token to stop reflecting
         */
        stopReflectToCSS(token) {
            if (this.isReflecting(token)) {
                this.reflecting.delete(token);
                DesignTokenNode.cssCustomPropertyReflector.stopReflection(token, this.target);
            }
        }
        /**
         * Determines if a token is being reflected to CSS for a node.
         * @param token - The token to check for reflection
         * @returns
         */
        isReflecting(token) {
            return this.reflecting.has(token);
        }
        /**
         * Handle changes to upstream tokens
         * @param source - The parent DesignTokenNode
         * @param property - The token ID that changed
         */
        handleChange(source, property) {
            const token = DesignTokenImpl.getTokenById(property);
            if (!token) {
                return;
            }
            this.hydrate(token, this.getRaw(token));
        }
        /**
         * Hydrates a token with a DesignTokenValue, making retrieval available.
         * @param token - The token to hydrate
         * @param value - The value to hydrate
         */
        hydrate(token, value) {
            if (!this.has(token)) {
                const observer = this.bindingObservers.get(token);
                if (DesignTokenImpl.isDerivedDesignTokenValue(value)) {
                    if (observer) {
                        // If the binding source doesn't match, we need
                        // to update the binding
                        if (observer.source !== value) {
                            this.tearDownBindingObserver(token);
                            this.setupBindingObserver(token, value);
                        }
                    }
                    else {
                        this.setupBindingObserver(token, value);
                    }
                }
                else {
                    if (observer) {
                        this.tearDownBindingObserver(token);
                    }
                    this.store.set(token, value);
                }
            }
        }
        /**
         * Sets up a binding observer for a derived token value that notifies token
         * subscribers on change.
         *
         * @param token - The token to notify when the binding updates
         * @param source - The binding source
         */
        setupBindingObserver(token, source) {
            const binding = new DesignTokenBindingObserver(source, token, this);
            this.bindingObservers.set(token, binding);
            return binding;
        }
        /**
         * Tear down a binding observer for a token.
         */
        tearDownBindingObserver(token) {
            if (this.bindingObservers.has(token)) {
                this.bindingObservers.get(token).disconnect();
                this.bindingObservers.delete(token);
                return true;
            }
            return false;
        }
    }
    /**
     * Responsible for reflecting tokens to CSS custom properties
     */
    DesignTokenNode.cssCustomPropertyReflector = new CustomPropertyReflector();
    __decorate$1([
        observable
    ], DesignTokenNode.prototype, "children", void 0);
    function create(nameOrConfig) {
        return DesignTokenImpl.from(nameOrConfig);
    }
    /* eslint-enable @typescript-eslint/no-unused-vars */
    /**
     * Factory object for creating {@link (DesignToken:interface)} instances.
     * @public
     */
    const DesignToken = Object.freeze({
        create,
        /**
         * Informs DesignToken that an HTMLElement for which tokens have
         * been set has been connected to the document.
         *
         * The browser does not provide a reliable mechanism to observe an HTMLElement's connectedness
         * in all scenarios, so invoking this method manually is necessary when:
         *
         * 1. Token values are set for an HTMLElement.
         * 2. The HTMLElement does not inherit from FASTElement.
         * 3. The HTMLElement is not connected to the document when token values are set.
         *
         * @param element - The element to notify
         * @returns - true if notification was successful, otherwise false.
         */
        notifyConnection(element) {
            if (!element.isConnected || !DesignTokenNode.existsFor(element)) {
                return false;
            }
            DesignTokenNode.getOrCreate(element).bind();
            return true;
        },
        /**
         * Informs DesignToken that an HTMLElement for which tokens have
         * been set has been disconnected to the document.
         *
         * The browser does not provide a reliable mechanism to observe an HTMLElement's connectedness
         * in all scenarios, so invoking this method manually is necessary when:
         *
         * 1. Token values are set for an HTMLElement.
         * 2. The HTMLElement does not inherit from FASTElement.
         *
         * @param element - The element to notify
         * @returns - true if notification was successful, otherwise false.
         */
        notifyDisconnection(element) {
            if (element.isConnected || !DesignTokenNode.existsFor(element)) {
                return false;
            }
            DesignTokenNode.getOrCreate(element).unbind();
            return true;
        },
        /**
         * Registers and element or document as a DesignToken root.
         * {@link CSSDesignToken | CSSDesignTokens} with default values assigned via
         * {@link (DesignToken:interface).withDefault} will emit CSS custom properties to all
         * registered roots.
         * @param target - The root to register
         */
        registerRoot(target = defaultElement) {
            RootStyleSheetTarget.registerRoot(target);
        },
        /**
         * Unregister an element or document as a DesignToken root.
         * @param target - The root to deregister
         */
        unregisterRoot(target = defaultElement) {
            RootStyleSheetTarget.unregisterRoot(target);
        },
    });
    /* eslint-enable @typescript-eslint/no-non-null-assertion */

    /* eslint-disable @typescript-eslint/no-non-null-assertion */
    /**
     * Indicates what to do with an ambiguous (duplicate) element.
     * @public
     */
    const ElementDisambiguation = Object.freeze({
        /**
         * Skip defining the element but still call the provided callback passed
         * to DesignSystemRegistrationContext.tryDefineElement
         */
        definitionCallbackOnly: null,
        /**
         * Ignore the duplicate element entirely.
         */
        ignoreDuplicate: Symbol(),
    });
    const elementTypesByTag = new Map();
    const elementTagsByType = new Map();
    let rootDesignSystem = null;
    const designSystemKey = DI.createInterface(x => x.cachedCallback(handler => {
        if (rootDesignSystem === null) {
            rootDesignSystem = new DefaultDesignSystem(null, handler);
        }
        return rootDesignSystem;
    }));
    /**
     * An API gateway to design system features.
     * @public
     */
    const DesignSystem = Object.freeze({
        /**
         * Returns the HTML element name that the type is defined as.
         * @param type - The type to lookup.
         * @public
         */
        tagFor(type) {
            return elementTagsByType.get(type);
        },
        /**
         * Searches the DOM hierarchy for the design system that is responsible
         * for the provided element.
         * @param element - The element to locate the design system for.
         * @returns The located design system.
         * @public
         */
        responsibleFor(element) {
            const owned = element.$$designSystem$$;
            if (owned) {
                return owned;
            }
            const container = DI.findResponsibleContainer(element);
            return container.get(designSystemKey);
        },
        /**
         * Gets the DesignSystem if one is explicitly defined on the provided element;
         * otherwise creates a design system defined directly on the element.
         * @param element - The element to get or create a design system for.
         * @returns The design system.
         * @public
         */
        getOrCreate(node) {
            if (!node) {
                if (rootDesignSystem === null) {
                    rootDesignSystem = DI.getOrCreateDOMContainer().get(designSystemKey);
                }
                return rootDesignSystem;
            }
            const owned = node.$$designSystem$$;
            if (owned) {
                return owned;
            }
            const container = DI.getOrCreateDOMContainer(node);
            if (container.has(designSystemKey, false)) {
                return container.get(designSystemKey);
            }
            else {
                const system = new DefaultDesignSystem(node, container);
                container.register(Registration.instance(designSystemKey, system));
                return system;
            }
        },
    });
    function extractTryDefineElementParams(params, elementDefinitionType, elementDefinitionCallback) {
        if (typeof params === "string") {
            return {
                name: params,
                type: elementDefinitionType,
                callback: elementDefinitionCallback,
            };
        }
        else {
            return params;
        }
    }
    class DefaultDesignSystem {
        constructor(owner, container) {
            this.owner = owner;
            this.container = container;
            this.designTokensInitialized = false;
            this.prefix = "fast";
            this.shadowRootMode = undefined;
            this.disambiguate = () => ElementDisambiguation.definitionCallbackOnly;
            if (owner !== null) {
                owner.$$designSystem$$ = this;
            }
        }
        withPrefix(prefix) {
            this.prefix = prefix;
            return this;
        }
        withShadowRootMode(mode) {
            this.shadowRootMode = mode;
            return this;
        }
        withElementDisambiguation(callback) {
            this.disambiguate = callback;
            return this;
        }
        withDesignTokenRoot(root) {
            this.designTokenRoot = root;
            return this;
        }
        register(...registrations) {
            const container = this.container;
            const elementDefinitionEntries = [];
            const disambiguate = this.disambiguate;
            const shadowRootMode = this.shadowRootMode;
            const context = {
                elementPrefix: this.prefix,
                tryDefineElement(params, elementDefinitionType, elementDefinitionCallback) {
                    const extractedParams = extractTryDefineElementParams(params, elementDefinitionType, elementDefinitionCallback);
                    const { name, callback, baseClass } = extractedParams;
                    let { type } = extractedParams;
                    let elementName = name;
                    let typeFoundByName = elementTypesByTag.get(elementName);
                    let needsDefine = true;
                    while (typeFoundByName) {
                        const result = disambiguate(elementName, type, typeFoundByName);
                        switch (result) {
                            case ElementDisambiguation.ignoreDuplicate:
                                return;
                            case ElementDisambiguation.definitionCallbackOnly:
                                needsDefine = false;
                                typeFoundByName = void 0;
                                break;
                            default:
                                elementName = result;
                                typeFoundByName = elementTypesByTag.get(elementName);
                                break;
                        }
                    }
                    if (needsDefine) {
                        if (elementTagsByType.has(type) || type === FoundationElement) {
                            type = class extends type {
                            };
                        }
                        elementTypesByTag.set(elementName, type);
                        elementTagsByType.set(type, elementName);
                        if (baseClass) {
                            elementTagsByType.set(baseClass, elementName);
                        }
                    }
                    elementDefinitionEntries.push(new ElementDefinitionEntry(container, elementName, type, shadowRootMode, callback, needsDefine));
                },
            };
            if (!this.designTokensInitialized) {
                this.designTokensInitialized = true;
                if (this.designTokenRoot !== null) {
                    DesignToken.registerRoot(this.designTokenRoot);
                }
            }
            container.registerWithContext(context, ...registrations);
            for (const entry of elementDefinitionEntries) {
                entry.callback(entry);
                if (entry.willDefine && entry.definition !== null) {
                    entry.definition.define();
                }
            }
            return this;
        }
    }
    class ElementDefinitionEntry {
        constructor(container, name, type, shadowRootMode, callback, willDefine) {
            this.container = container;
            this.name = name;
            this.type = type;
            this.shadowRootMode = shadowRootMode;
            this.callback = callback;
            this.willDefine = willDefine;
            this.definition = null;
        }
        definePresentation(presentation) {
            ComponentPresentation.define(this.name, presentation, this.container);
        }
        defineElement(definition) {
            this.definition = new FASTElementDefinition(this.type, Object.assign(Object.assign({}, definition), { name: this.name }));
        }
        tagFor(type) {
            return DesignSystem.tagFor(type);
        }
    }
    /* eslint-enable @typescript-eslint/no-non-null-assertion */

    /**
     * The template for the {@link @microsoft/fast-foundation#Dialog} component.
     * @public
     */
    const dialogTemplate = (context, definition) => html `
    <div class="positioning-region" part="positioning-region">
        ${when(x => x.modal, html `
                <div
                    class="overlay"
                    part="overlay"
                    role="presentation"
                    @click="${x => x.dismiss()}"
                ></div>
            `)}
        <div
            role="dialog"
            tabindex="-1"
            class="control"
            part="control"
            aria-modal="${x => x.modal}"
            aria-describedby="${x => x.ariaDescribedby}"
            aria-labelledby="${x => x.ariaLabelledby}"
            aria-label="${x => x.ariaLabel}"
            ${ref("dialog")}
        >
            <slot></slot>
        </div>
    </div>
`;

    /*!
    * tabbable 5.2.1
    * @license MIT, https://github.com/focus-trap/tabbable/blob/master/LICENSE
    */
    var candidateSelectors = ['input', 'select', 'textarea', 'a[href]', 'button', '[tabindex]', 'audio[controls]', 'video[controls]', '[contenteditable]:not([contenteditable="false"])', 'details>summary:first-of-type', 'details'];
    var candidateSelector = /* #__PURE__ */candidateSelectors.join(',');
    var matches = typeof Element === 'undefined' ? function () {} : Element.prototype.matches || Element.prototype.msMatchesSelector || Element.prototype.webkitMatchesSelector;

    var isContentEditable = function isContentEditable(node) {
      return node.contentEditable === 'true';
    };

    var getTabindex = function getTabindex(node) {
      var tabindexAttr = parseInt(node.getAttribute('tabindex'), 10);

      if (!isNaN(tabindexAttr)) {
        return tabindexAttr;
      } // Browsers do not return `tabIndex` correctly for contentEditable nodes;
      // so if they don't have a tabindex attribute specifically set, assume it's 0.


      if (isContentEditable(node)) {
        return 0;
      } // in Chrome, <details/>, <audio controls/> and <video controls/> elements get a default
      //  `tabIndex` of -1 when the 'tabindex' attribute isn't specified in the DOM,
      //  yet they are still part of the regular tab order; in FF, they get a default
      //  `tabIndex` of 0; since Chrome still puts those elements in the regular tab
      //  order, consider their tab index to be 0.


      if ((node.nodeName === 'AUDIO' || node.nodeName === 'VIDEO' || node.nodeName === 'DETAILS') && node.getAttribute('tabindex') === null) {
        return 0;
      }

      return node.tabIndex;
    };

    var isInput = function isInput(node) {
      return node.tagName === 'INPUT';
    };

    var isHiddenInput = function isHiddenInput(node) {
      return isInput(node) && node.type === 'hidden';
    };

    var isDetailsWithSummary = function isDetailsWithSummary(node) {
      var r = node.tagName === 'DETAILS' && Array.prototype.slice.apply(node.children).some(function (child) {
        return child.tagName === 'SUMMARY';
      });
      return r;
    };

    var getCheckedRadio = function getCheckedRadio(nodes, form) {
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].checked && nodes[i].form === form) {
          return nodes[i];
        }
      }
    };

    var isTabbableRadio = function isTabbableRadio(node) {
      if (!node.name) {
        return true;
      }

      var radioScope = node.form || node.ownerDocument;

      var queryRadios = function queryRadios(name) {
        return radioScope.querySelectorAll('input[type="radio"][name="' + name + '"]');
      };

      var radioSet;

      if (typeof window !== 'undefined' && typeof window.CSS !== 'undefined' && typeof window.CSS.escape === 'function') {
        radioSet = queryRadios(window.CSS.escape(node.name));
      } else {
        try {
          radioSet = queryRadios(node.name);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('Looks like you have a radio button with a name attribute containing invalid CSS selector characters and need the CSS.escape polyfill: %s', err.message);
          return false;
        }
      }

      var checked = getCheckedRadio(radioSet, node.form);
      return !checked || checked === node;
    };

    var isRadio = function isRadio(node) {
      return isInput(node) && node.type === 'radio';
    };

    var isNonTabbableRadio = function isNonTabbableRadio(node) {
      return isRadio(node) && !isTabbableRadio(node);
    };

    var isHidden = function isHidden(node, displayCheck) {
      if (getComputedStyle(node).visibility === 'hidden') {
        return true;
      }

      var isDirectSummary = matches.call(node, 'details>summary:first-of-type');
      var nodeUnderDetails = isDirectSummary ? node.parentElement : node;

      if (matches.call(nodeUnderDetails, 'details:not([open]) *')) {
        return true;
      }

      if (!displayCheck || displayCheck === 'full') {
        while (node) {
          if (getComputedStyle(node).display === 'none') {
            return true;
          }

          node = node.parentElement;
        }
      } else if (displayCheck === 'non-zero-area') {
        var _node$getBoundingClie = node.getBoundingClientRect(),
            width = _node$getBoundingClie.width,
            height = _node$getBoundingClie.height;

        return width === 0 && height === 0;
      }

      return false;
    }; // form fields (nested) inside a disabled fieldset are not focusable/tabbable
    //  unless they are in the _first_ <legend> element of the top-most disabled
    //  fieldset


    var isDisabledFromFieldset = function isDisabledFromFieldset(node) {
      if (isInput(node) || node.tagName === 'SELECT' || node.tagName === 'TEXTAREA' || node.tagName === 'BUTTON') {
        var parentNode = node.parentElement;

        while (parentNode) {
          if (parentNode.tagName === 'FIELDSET' && parentNode.disabled) {
            // look for the first <legend> as an immediate child of the disabled
            //  <fieldset>: if the node is in that legend, it'll be enabled even
            //  though the fieldset is disabled; otherwise, the node is in a
            //  secondary/subsequent legend, or somewhere else within the fieldset
            //  (however deep nested) and it'll be disabled
            for (var i = 0; i < parentNode.children.length; i++) {
              var child = parentNode.children.item(i);

              if (child.tagName === 'LEGEND') {
                if (child.contains(node)) {
                  return false;
                } // the node isn't in the first legend (in doc order), so no matter
                //  where it is now, it'll be disabled


                return true;
              }
            } // the node isn't in a legend, so no matter where it is now, it'll be disabled


            return true;
          }

          parentNode = parentNode.parentElement;
        }
      } // else, node's tabbable/focusable state should not be affected by a fieldset's
      //  enabled/disabled state


      return false;
    };

    var isNodeMatchingSelectorFocusable = function isNodeMatchingSelectorFocusable(options, node) {
      if (node.disabled || isHiddenInput(node) || isHidden(node, options.displayCheck) || // For a details element with a summary, the summary element gets the focus
      isDetailsWithSummary(node) || isDisabledFromFieldset(node)) {
        return false;
      }

      return true;
    };

    var isNodeMatchingSelectorTabbable = function isNodeMatchingSelectorTabbable(options, node) {
      if (!isNodeMatchingSelectorFocusable(options, node) || isNonTabbableRadio(node) || getTabindex(node) < 0) {
        return false;
      }

      return true;
    };

    var isTabbable = function isTabbable(node, options) {
      options = options || {};

      if (!node) {
        throw new Error('No node provided');
      }

      if (matches.call(node, candidateSelector) === false) {
        return false;
      }

      return isNodeMatchingSelectorTabbable(options, node);
    };

    /**
     * A Switch Custom HTML Element.
     * Implements the {@link https://www.w3.org/TR/wai-aria-1.1/#dialog | ARIA dialog }.
     *
     * @public
     */
    class Dialog extends FoundationElement {
        constructor() {
            super(...arguments);
            /**
             * Indicates the element is modal. When modal, user mouse interaction will be limited to the contents of the element by a modal
             * overlay.  Clicks on the overlay will cause the dialog to emit a "dismiss" event.
             * @public
             * @defaultValue - true
             * @remarks
             * HTML Attribute: modal
             */
            this.modal = true;
            /**
             * The hidden state of the element.
             *
             * @public
             * @defaultValue - false
             * @remarks
             * HTML Attribute: hidden
             */
            this.hidden = false;
            /**
             * Indicates that the dialog should trap focus.
             *
             * @public
             * @defaultValue - true
             * @remarks
             * HTML Attribute: trap-focus
             */
            this.trapFocus = true;
            this.trapFocusChanged = () => {
                if (this.$fastController.isConnected) {
                    this.updateTrapFocus();
                }
            };
            /**
             * @internal
             */
            this.isTrappingFocus = false;
            this.handleDocumentKeydown = (e) => {
                if (!e.defaultPrevented && !this.hidden) {
                    switch (e.key) {
                        case keyEscape:
                            this.dismiss();
                            e.preventDefault();
                            break;
                        case keyTab:
                            this.handleTabKeyDown(e);
                            break;
                    }
                }
            };
            this.handleDocumentFocus = (e) => {
                if (!e.defaultPrevented && this.shouldForceFocus(e.target)) {
                    this.focusFirstElement();
                    e.preventDefault();
                }
            };
            this.handleTabKeyDown = (e) => {
                if (!this.trapFocus || this.hidden) {
                    return;
                }
                const bounds = this.getTabQueueBounds();
                if (bounds.length === 0) {
                    return;
                }
                if (bounds.length === 1) {
                    // keep focus on single element
                    bounds[0].focus();
                    e.preventDefault();
                    return;
                }
                if (e.shiftKey && e.target === bounds[0]) {
                    bounds[bounds.length - 1].focus();
                    e.preventDefault();
                }
                else if (!e.shiftKey && e.target === bounds[bounds.length - 1]) {
                    bounds[0].focus();
                    e.preventDefault();
                }
                return;
            };
            this.getTabQueueBounds = () => {
                const bounds = [];
                return Dialog.reduceTabbableItems(bounds, this);
            };
            /**
             * focus on first element of tab queue
             */
            this.focusFirstElement = () => {
                const bounds = this.getTabQueueBounds();
                if (bounds.length > 0) {
                    bounds[0].focus();
                }
                else {
                    if (this.dialog instanceof HTMLElement) {
                        this.dialog.focus();
                    }
                }
            };
            /**
             * we should only focus if focus has not already been brought to the dialog
             */
            this.shouldForceFocus = (currentFocusElement) => {
                return this.isTrappingFocus && !this.contains(currentFocusElement);
            };
            /**
             * we should we be active trapping focus
             */
            this.shouldTrapFocus = () => {
                return this.trapFocus && !this.hidden;
            };
            /**
             *
             *
             * @internal
             */
            this.updateTrapFocus = (shouldTrapFocusOverride) => {
                const shouldTrapFocus = shouldTrapFocusOverride === undefined
                    ? this.shouldTrapFocus()
                    : shouldTrapFocusOverride;
                if (shouldTrapFocus && !this.isTrappingFocus) {
                    this.isTrappingFocus = true;
                    // Add an event listener for focusin events if we are trapping focus
                    document.addEventListener("focusin", this.handleDocumentFocus);
                    DOM.queueUpdate(() => {
                        if (this.shouldForceFocus(document.activeElement)) {
                            this.focusFirstElement();
                        }
                    });
                }
                else if (!shouldTrapFocus && this.isTrappingFocus) {
                    this.isTrappingFocus = false;
                    // remove event listener if we are not trapping focus
                    document.removeEventListener("focusin", this.handleDocumentFocus);
                }
            };
        }
        /**
         * @internal
         */
        dismiss() {
            this.$emit("dismiss");
        }
        /**
         * The method to show the dialog.
         *
         * @public
         */
        show() {
            this.hidden = false;
        }
        /**
         * The method to hide the dialog.
         *
         * @public
         */
        hide() {
            this.hidden = true;
        }
        /**
         * @internal
         */
        connectedCallback() {
            super.connectedCallback();
            document.addEventListener("keydown", this.handleDocumentKeydown);
            this.notifier = Observable.getNotifier(this);
            this.notifier.subscribe(this, "hidden");
            this.updateTrapFocus();
        }
        /**
         * @internal
         */
        disconnectedCallback() {
            super.disconnectedCallback();
            // remove keydown event listener
            document.removeEventListener("keydown", this.handleDocumentKeydown);
            // if we are trapping focus remove the focusin listener
            this.updateTrapFocus(false);
            this.notifier.unsubscribe(this, "hidden");
        }
        /**
         * @internal
         */
        handleChange(source, propertyName) {
            switch (propertyName) {
                case "hidden":
                    this.updateTrapFocus();
                    break;
            }
        }
        /**
         * Reduce a collection to only its focusable elements.
         *
         * @param elements - Collection of elements to reduce
         * @param element - The current element
         *
         * @internal
         */
        static reduceTabbableItems(elements, element) {
            if (element.getAttribute("tabindex") === "-1") {
                return elements;
            }
            if (isTabbable(element) ||
                (Dialog.isFocusableFastElement(element) && Dialog.hasTabbableShadow(element))) {
                elements.push(element);
                return elements;
            }
            if (element.childElementCount) {
                return elements.concat(Array.from(element.children).reduce(Dialog.reduceTabbableItems, []));
            }
            return elements;
        }
        /**
         * Test if element is focusable fast element
         *
         * @param element - The element to check
         *
         * @internal
         */
        static isFocusableFastElement(element) {
            var _a, _b;
            return !!((_b = (_a = element.$fastController) === null || _a === void 0 ? void 0 : _a.definition.shadowOptions) === null || _b === void 0 ? void 0 : _b.delegatesFocus);
        }
        /**
         * Test if the element has a focusable shadow
         *
         * @param element - The element to check
         *
         * @internal
         */
        static hasTabbableShadow(element) {
            var _a, _b;
            return Array.from((_b = (_a = element.shadowRoot) === null || _a === void 0 ? void 0 : _a.querySelectorAll("*")) !== null && _b !== void 0 ? _b : []).some(x => {
                return isTabbable(x);
            });
        }
    }
    __decorate$1([
        attr({ mode: "boolean" })
    ], Dialog.prototype, "modal", void 0);
    __decorate$1([
        attr({ mode: "boolean" })
    ], Dialog.prototype, "hidden", void 0);
    __decorate$1([
        attr({ attribute: "trap-focus", mode: "boolean" })
    ], Dialog.prototype, "trapFocus", void 0);
    __decorate$1([
        attr({ attribute: "aria-describedby" })
    ], Dialog.prototype, "ariaDescribedby", void 0);
    __decorate$1([
        attr({ attribute: "aria-labelledby" })
    ], Dialog.prototype, "ariaLabelledby", void 0);
    __decorate$1([
        attr({ attribute: "aria-label" })
    ], Dialog.prototype, "ariaLabel", void 0);

    /**
     * The template for the {@link @microsoft/fast-foundation#(ListboxOption:class)} component.
     * @public
     */
    const listboxOptionTemplate = (context, definition) => html `
    <template
        aria-checked="${x => x.ariaChecked}"
        aria-disabled="${x => x.ariaDisabled}"
        aria-posinset="${x => x.ariaPosInSet}"
        aria-selected="${x => x.ariaSelected}"
        aria-setsize="${x => x.ariaSetSize}"
        class="${x => [x.checked && "checked", x.selected && "selected", x.disabled && "disabled"]
    .filter(Boolean)
    .join(" ")}"
        role="option"
    >
        ${startSlotTemplate(context, definition)}
        <span class="content" part="content">
            <slot></slot>
        </span>
        ${endSlotTemplate(context, definition)}
    </template>
`;

    /**
     * Menu items roles.
     * @public
     */
    var MenuItemRole;
    (function (MenuItemRole) {
        /**
         * The menu item has a "menuitem" role
         */
        MenuItemRole["menuitem"] = "menuitem";
        /**
         * The menu item has a "menuitemcheckbox" role
         */
        MenuItemRole["menuitemcheckbox"] = "menuitemcheckbox";
        /**
         * The menu item has a "menuitemradio" role
         */
        MenuItemRole["menuitemradio"] = "menuitemradio";
    })(MenuItemRole || (MenuItemRole = {}));
    /**
     * @internal
     */
    const roleForMenuItem = {
        [MenuItemRole.menuitem]: "menuitem",
        [MenuItemRole.menuitemcheckbox]: "menuitemcheckbox",
        [MenuItemRole.menuitemradio]: "menuitemradio",
    };

    /**
     * A Switch Custom HTML Element.
     * Implements {@link https://www.w3.org/TR/wai-aria-1.1/#menuitem | ARIA menuitem }, {@link https://www.w3.org/TR/wai-aria-1.1/#menuitemcheckbox | ARIA menuitemcheckbox}, or {@link https://www.w3.org/TR/wai-aria-1.1/#menuitemradio | ARIA menuitemradio }.
     *
     * @public
     */
    class MenuItem$1 extends FoundationElement {
        constructor() {
            super(...arguments);
            /**
             * The role of the element.
             *
             * @public
             * @remarks
             * HTML Attribute: role
             */
            this.role = MenuItemRole.menuitem;
            /**
             * @internal
             */
            this.hasSubmenu = false;
            /**
             * Track current direction to pass to the anchored region
             *
             * @internal
             */
            this.currentDirection = Direction.ltr;
            this.focusSubmenuOnLoad = false;
            /**
             * @internal
             */
            this.handleMenuItemKeyDown = (e) => {
                if (e.defaultPrevented) {
                    return false;
                }
                switch (e.key) {
                    case keyEnter:
                    case keySpace:
                        this.invoke();
                        return false;
                    case keyArrowRight:
                        //open/focus on submenu
                        this.expandAndFocus();
                        return false;
                    case keyArrowLeft:
                        //close submenu
                        if (this.expanded) {
                            this.expanded = false;
                            this.focus();
                            return false;
                        }
                }
                return true;
            };
            /**
             * @internal
             */
            this.handleMenuItemClick = (e) => {
                if (e.defaultPrevented || this.disabled) {
                    return false;
                }
                this.invoke();
                return false;
            };
            /**
             * @internal
             */
            this.submenuLoaded = () => {
                if (!this.focusSubmenuOnLoad) {
                    return;
                }
                this.focusSubmenuOnLoad = false;
                if (this.hasSubmenu) {
                    this.submenu.focus();
                    this.setAttribute("tabindex", "-1");
                }
            };
            /**
             * @internal
             */
            this.handleMouseOver = (e) => {
                if (this.disabled || !this.hasSubmenu || this.expanded) {
                    return false;
                }
                this.expanded = true;
                return false;
            };
            /**
             * @internal
             */
            this.handleMouseOut = (e) => {
                if (!this.expanded || this.contains(document.activeElement)) {
                    return false;
                }
                this.expanded = false;
                return false;
            };
            /**
             * @internal
             */
            this.expandAndFocus = () => {
                if (!this.hasSubmenu) {
                    return;
                }
                this.focusSubmenuOnLoad = true;
                this.expanded = true;
            };
            /**
             * @internal
             */
            this.invoke = () => {
                if (this.disabled) {
                    return;
                }
                switch (this.role) {
                    case MenuItemRole.menuitemcheckbox:
                        this.checked = !this.checked;
                        break;
                    case MenuItemRole.menuitem:
                        // update submenu
                        this.updateSubmenu();
                        if (this.hasSubmenu) {
                            this.expandAndFocus();
                        }
                        else {
                            this.$emit("change");
                        }
                        break;
                    case MenuItemRole.menuitemradio:
                        if (!this.checked) {
                            this.checked = true;
                        }
                        break;
                }
            };
            /**
             * Gets the submenu element if any
             *
             * @internal
             */
            this.updateSubmenu = () => {
                this.submenu = this.domChildren().find((element) => {
                    return element.getAttribute("role") === "menu";
                });
                this.hasSubmenu = this.submenu === undefined ? false : true;
            };
        }
        expandedChanged(oldValue) {
            if (this.$fastController.isConnected) {
                if (this.submenu === undefined) {
                    return;
                }
                if (this.expanded === false) {
                    this.submenu.collapseExpandedItem();
                }
                else {
                    this.currentDirection = getDirection(this);
                }
                this.$emit("expanded-change", this, { bubbles: false });
            }
        }
        checkedChanged(oldValue, newValue) {
            if (this.$fastController.isConnected) {
                this.$emit("change");
            }
        }
        /**
         * @internal
         */
        connectedCallback() {
            super.connectedCallback();
            DOM.queueUpdate(() => {
                this.updateSubmenu();
            });
            if (!this.startColumnCount) {
                this.startColumnCount = 1;
            }
            this.observer = new MutationObserver(this.updateSubmenu);
        }
        /**
         * @internal
         */
        disconnectedCallback() {
            super.disconnectedCallback();
            this.submenu = undefined;
            if (this.observer !== undefined) {
                this.observer.disconnect();
                this.observer = undefined;
            }
        }
        /**
         * get an array of valid DOM children
         */
        domChildren() {
            return Array.from(this.children);
        }
    }
    __decorate$1([
        attr({ mode: "boolean" })
    ], MenuItem$1.prototype, "disabled", void 0);
    __decorate$1([
        attr({ mode: "boolean" })
    ], MenuItem$1.prototype, "expanded", void 0);
    __decorate$1([
        observable
    ], MenuItem$1.prototype, "startColumnCount", void 0);
    __decorate$1([
        attr
    ], MenuItem$1.prototype, "role", void 0);
    __decorate$1([
        attr({ mode: "boolean" })
    ], MenuItem$1.prototype, "checked", void 0);
    __decorate$1([
        observable
    ], MenuItem$1.prototype, "submenuRegion", void 0);
    __decorate$1([
        observable
    ], MenuItem$1.prototype, "hasSubmenu", void 0);
    __decorate$1([
        observable
    ], MenuItem$1.prototype, "currentDirection", void 0);
    __decorate$1([
        observable
    ], MenuItem$1.prototype, "submenu", void 0);
    applyMixins(MenuItem$1, StartEnd);

    /**
     * Generates a template for the {@link @microsoft/fast-foundation#(MenuItem:class)} component using
     * the provided prefix.
     *
     * @public
     */
    const menuItemTemplate = (context, definition) => html `
    <template
        role="${x => x.role}"
        aria-haspopup="${x => (x.hasSubmenu ? "menu" : void 0)}"
        aria-checked="${x => (x.role !== MenuItemRole.menuitem ? x.checked : void 0)}"
        aria-disabled="${x => x.disabled}"
        aria-expanded="${x => x.expanded}"
        @keydown="${(x, c) => x.handleMenuItemKeyDown(c.event)}"
        @click="${(x, c) => x.handleMenuItemClick(c.event)}"
        @mouseover="${(x, c) => x.handleMouseOver(c.event)}"
        @mouseout="${(x, c) => x.handleMouseOut(c.event)}"
        class="${x => (x.disabled ? "disabled" : "")} ${x => x.expanded ? "expanded" : ""} ${x => `indent-${x.startColumnCount}`}"
    >
            ${when(x => x.role === MenuItemRole.menuitemcheckbox, html `
                    <div part="input-container" class="input-container">
                        <span part="checkbox" class="checkbox">
                            <slot name="checkbox-indicator">
                                ${definition.checkboxIndicator || ""}
                            </slot>
                        </span>
                    </div>
                `)}
            ${when(x => x.role === MenuItemRole.menuitemradio, html `
                    <div part="input-container" class="input-container">
                        <span part="radio" class="radio">
                            <slot name="radio-indicator">
                                ${definition.radioIndicator || ""}
                            </slot>
                        </span>
                    </div>
                `)}
        </div>
        ${startSlotTemplate(context, definition)}
        <span class="content" part="content">
            <slot></slot>
        </span>
        ${endSlotTemplate(context, definition)}
        ${when(x => x.hasSubmenu, html `
                <div
                    part="expand-collapse-glyph-container"
                    class="expand-collapse-glyph-container"
                >
                    <span part="expand-collapse" class="expand-collapse">
                        <slot name="expand-collapse-indicator">
                            ${definition.expandCollapseGlyph || ""}
                        </slot>
                    </span>
                </div>
            `)}
        ${when(x => x.expanded, html `
                <${context.tagFor(AnchoredRegion)}
                    :anchorElement="${x => x}"
                    vertical-positioning-mode="dynamic"
                    vertical-default-position="bottom"
                    vertical-inset="true"
                    horizontal-positioning-mode="dynamic"
                    horizontal-default-position="end"
                    class="submenu-region"
                    dir="${x => x.currentDirection}"
                    @loaded="${x => x.submenuLoaded()}"
                    ${ref("submenuRegion")}
                    part="submenu-region"
                >
                    <slot name="submenu"></slot>
                </${context.tagFor(AnchoredRegion)}>
            `)}
    </template>
`;

    /**
     * The template for the {@link @microsoft/fast-foundation#Menu} component.
     * @public
     */
    const menuTemplate = (context, definition) => html `
    <template
        slot="${x => (x.slot ? x.slot : x.isNestedMenu() ? "submenu" : void 0)}"
        role="menu"
        @keydown="${(x, c) => x.handleMenuKeyDown(c.event)}"
        @focusout="${(x, c) => x.handleFocusOut(c.event)}"
    >
        <slot ${slotted("items")}></slot>
    </template>
`;

    /**
     * A Menu Custom HTML Element.
     * Implements the {@link https://www.w3.org/TR/wai-aria-1.1/#menu | ARIA menu }.
     *
     * @public
     */
    class Menu$1 extends FoundationElement {
        constructor() {
            super(...arguments);
            this.expandedItem = null;
            /**
             * The index of the focusable element in the items array
             * defaults to -1
             */
            this.focusIndex = -1;
            /**
             * @internal
             */
            this.isNestedMenu = () => {
                return (this.parentElement !== null &&
                    isHTMLElement(this.parentElement) &&
                    this.parentElement.getAttribute("role") === "menuitem");
            };
            /**
             * if focus is moving out of the menu, reset to a stable initial state
             * @internal
             */
            this.handleFocusOut = (e) => {
                if (!this.contains(e.relatedTarget) && this.menuItems !== undefined) {
                    this.collapseExpandedItem();
                    // find our first focusable element
                    const focusIndex = this.menuItems.findIndex(this.isFocusableElement);
                    // set the current focus index's tabindex to -1
                    this.menuItems[this.focusIndex].setAttribute("tabindex", "-1");
                    // set the first focusable element tabindex to 0
                    this.menuItems[focusIndex].setAttribute("tabindex", "0");
                    // set the focus index
                    this.focusIndex = focusIndex;
                }
            };
            this.handleItemFocus = (e) => {
                const targetItem = e.target;
                if (this.menuItems !== undefined &&
                    targetItem !== this.menuItems[this.focusIndex]) {
                    this.menuItems[this.focusIndex].setAttribute("tabindex", "-1");
                    this.focusIndex = this.menuItems.indexOf(targetItem);
                    targetItem.setAttribute("tabindex", "0");
                }
            };
            this.handleExpandedChanged = (e) => {
                if (e.defaultPrevented ||
                    e.target === null ||
                    this.menuItems === undefined ||
                    this.menuItems.indexOf(e.target) < 0) {
                    return;
                }
                e.preventDefault();
                const changedItem = e.target;
                // closing an expanded item without opening another
                if (this.expandedItem !== null &&
                    changedItem === this.expandedItem &&
                    changedItem.expanded === false) {
                    this.expandedItem = null;
                    return;
                }
                if (changedItem.expanded) {
                    if (this.expandedItem !== null && this.expandedItem !== changedItem) {
                        this.expandedItem.expanded = false;
                    }
                    this.menuItems[this.focusIndex].setAttribute("tabindex", "-1");
                    this.expandedItem = changedItem;
                    this.focusIndex = this.menuItems.indexOf(changedItem);
                    changedItem.setAttribute("tabindex", "0");
                }
            };
            this.removeItemListeners = () => {
                if (this.menuItems !== undefined) {
                    this.menuItems.forEach((item) => {
                        item.removeEventListener("expanded-change", this.handleExpandedChanged);
                        item.removeEventListener("focus", this.handleItemFocus);
                    });
                }
            };
            this.setItems = () => {
                const newItems = this.domChildren();
                this.removeItemListeners();
                this.menuItems = newItems;
                const menuItems = this.menuItems.filter(this.isMenuItemElement);
                // if our focus index is not -1 we have items
                if (menuItems.length) {
                    this.focusIndex = 0;
                }
                function elementIndent(el) {
                    const role = el.getAttribute("role");
                    const startSlot = el.querySelector("[slot=start]");
                    if (role !== MenuItemRole.menuitem && startSlot === null) {
                        return 1;
                    }
                    else if (role === MenuItemRole.menuitem && startSlot !== null) {
                        return 1;
                    }
                    else if (role !== MenuItemRole.menuitem && startSlot !== null) {
                        return 2;
                    }
                    else {
                        return 0;
                    }
                }
                const indent = menuItems.reduce((accum, current) => {
                    const elementValue = elementIndent(current);
                    return accum > elementValue ? accum : elementValue;
                }, 0);
                menuItems.forEach((item, index) => {
                    item.setAttribute("tabindex", index === 0 ? "0" : "-1");
                    item.addEventListener("expanded-change", this.handleExpandedChanged);
                    item.addEventListener("focus", this.handleItemFocus);
                    if (item instanceof MenuItem$1) {
                        item.startColumnCount = indent;
                    }
                });
            };
            /**
             * handle change from child element
             */
            this.changeHandler = (e) => {
                if (this.menuItems === undefined) {
                    return;
                }
                const changedMenuItem = e.target;
                const changeItemIndex = this.menuItems.indexOf(changedMenuItem);
                if (changeItemIndex === -1) {
                    return;
                }
                if (changedMenuItem.role === "menuitemradio" &&
                    changedMenuItem.checked === true) {
                    for (let i = changeItemIndex - 1; i >= 0; --i) {
                        const item = this.menuItems[i];
                        const role = item.getAttribute("role");
                        if (role === MenuItemRole.menuitemradio) {
                            item.checked = false;
                        }
                        if (role === "separator") {
                            break;
                        }
                    }
                    const maxIndex = this.menuItems.length - 1;
                    for (let i = changeItemIndex + 1; i <= maxIndex; ++i) {
                        const item = this.menuItems[i];
                        const role = item.getAttribute("role");
                        if (role === MenuItemRole.menuitemradio) {
                            item.checked = false;
                        }
                        if (role === "separator") {
                            break;
                        }
                    }
                }
            };
            /**
             * check if the item is a menu item
             */
            this.isMenuItemElement = (el) => {
                return (isHTMLElement(el) &&
                    Menu$1.focusableElementRoles.hasOwnProperty(el.getAttribute("role")));
            };
            /**
             * check if the item is focusable
             */
            this.isFocusableElement = (el) => {
                return this.isMenuItemElement(el);
            };
        }
        itemsChanged(oldValue, newValue) {
            // only update children after the component is connected and
            // the setItems has run on connectedCallback
            // (menuItems is undefined until then)
            if (this.$fastController.isConnected && this.menuItems !== undefined) {
                this.setItems();
            }
        }
        /**
         * @internal
         */
        connectedCallback() {
            super.connectedCallback();
            DOM.queueUpdate(() => {
                // wait until children have had a chance to
                // connect before setting/checking their props/attributes
                this.setItems();
            });
            this.addEventListener("change", this.changeHandler);
        }
        /**
         * @internal
         */
        disconnectedCallback() {
            super.disconnectedCallback();
            this.removeItemListeners();
            this.menuItems = undefined;
            this.removeEventListener("change", this.changeHandler);
        }
        /**
         * Focuses the first item in the menu.
         *
         * @public
         */
        focus() {
            this.setFocus(0, 1);
        }
        /**
         * Collapses any expanded menu items.
         *
         * @public
         */
        collapseExpandedItem() {
            if (this.expandedItem !== null) {
                this.expandedItem.expanded = false;
                this.expandedItem = null;
            }
        }
        /**
         * @internal
         */
        handleMenuKeyDown(e) {
            if (e.defaultPrevented || this.menuItems === undefined) {
                return;
            }
            switch (e.key) {
                case keyArrowDown:
                    // go forward one index
                    this.setFocus(this.focusIndex + 1, 1);
                    return;
                case keyArrowUp:
                    // go back one index
                    this.setFocus(this.focusIndex - 1, -1);
                    return;
                case keyEnd:
                    // set focus on last item
                    this.setFocus(this.menuItems.length - 1, -1);
                    return;
                case keyHome:
                    // set focus on first item
                    this.setFocus(0, 1);
                    return;
                default:
                    // if we are not handling the event, do not prevent default
                    return true;
            }
        }
        /**
         * get an array of valid DOM children
         */
        domChildren() {
            return Array.from(this.children);
        }
        setFocus(focusIndex, adjustment) {
            if (this.menuItems === undefined) {
                return;
            }
            while (focusIndex >= 0 && focusIndex < this.menuItems.length) {
                const child = this.menuItems[focusIndex];
                if (this.isFocusableElement(child)) {
                    // change the previous index to -1
                    if (this.focusIndex > -1 &&
                        this.menuItems.length >= this.focusIndex - 1) {
                        this.menuItems[this.focusIndex].setAttribute("tabindex", "-1");
                    }
                    // update the focus index
                    this.focusIndex = focusIndex;
                    // update the tabindex of next focusable element
                    child.setAttribute("tabindex", "0");
                    // focus the element
                    child.focus();
                    break;
                }
                focusIndex += adjustment;
            }
        }
    }
    Menu$1.focusableElementRoles = roleForMenuItem;
    __decorate$1([
        observable
    ], Menu$1.prototype, "items", void 0);

    /**
     * The template for the {@link @microsoft/fast-foundation#(NumberField:class)} component.
     * @public
     */
    const numberFieldTemplate = (context, definition) => html `
    <template class="${x => (x.readOnly ? "readonly" : "")}">
        <label
            part="label"
            for="control"
            class="${x => x.defaultSlottedNodes && x.defaultSlottedNodes.length
    ? "label"
    : "label label__hidden"}"
        >
            <slot ${slotted("defaultSlottedNodes")}></slot>
        </label>
        <div class="root" part="root">
            ${startSlotTemplate(context, definition)}
            <input
                class="control"
                part="control"
                id="control"
                @input="${x => x.handleTextInput()}"
                @change="${x => x.handleChange()}"
                @keydown="${(x, c) => x.handleKeyDown(c.event)}"
                @blur="${(x, c) => x.handleBlur()}"
                ?autofocus="${x => x.autofocus}"
                ?disabled="${x => x.disabled}"
                list="${x => x.list}"
                maxlength="${x => x.maxlength}"
                minlength="${x => x.minlength}"
                placeholder="${x => x.placeholder}"
                ?readonly="${x => x.readOnly}"
                ?required="${x => x.required}"
                size="${x => x.size}"
                type="text"
                inputmode="numeric"
                min="${x => x.min}"
                max="${x => x.max}"
                step="${x => x.step}"
                aria-atomic="${x => x.ariaAtomic}"
                aria-busy="${x => x.ariaBusy}"
                aria-controls="${x => x.ariaControls}"
                aria-current="${x => x.ariaCurrent}"
                aria-describedby="${x => x.ariaDescribedby}"
                aria-details="${x => x.ariaDetails}"
                aria-disabled="${x => x.ariaDisabled}"
                aria-errormessage="${x => x.ariaErrormessage}"
                aria-flowto="${x => x.ariaFlowto}"
                aria-haspopup="${x => x.ariaHaspopup}"
                aria-hidden="${x => x.ariaHidden}"
                aria-invalid="${x => x.ariaInvalid}"
                aria-keyshortcuts="${x => x.ariaKeyshortcuts}"
                aria-label="${x => x.ariaLabel}"
                aria-labelledby="${x => x.ariaLabelledby}"
                aria-live="${x => x.ariaLive}"
                aria-owns="${x => x.ariaOwns}"
                aria-relevant="${x => x.ariaRelevant}"
                aria-roledescription="${x => x.ariaRoledescription}"
                ${ref("control")}
            />
            ${when(x => !x.hideStep && !x.readOnly && !x.disabled, html `
                    <div class="controls" part="controls">
                        <div class="step-up" part="step-up" @click="${x => x.stepUp()}">
                            <slot name="step-up-glyph">
                                ${definition.stepUpGlyph || ""}
                            </slot>
                        </div>
                        <div
                            class="step-down"
                            part="step-down"
                            @click="${x => x.stepDown()}"
                        >
                            <slot name="step-down-glyph">
                                ${definition.stepDownGlyph || ""}
                            </slot>
                        </div>
                    </div>
                `)}
            ${endSlotTemplate(context, definition)}
        </div>
    </template>
`;

    /**
     * The template for the {@link @microsoft/fast-foundation#(TextField:class)} component.
     * @public
     */
    const textFieldTemplate = (context, definition) => html `
    <template
        class="
            ${x => (x.readOnly ? "readonly" : "")}
        "
    >
        <label
            part="label"
            for="control"
            class="${x => x.defaultSlottedNodes && x.defaultSlottedNodes.length
    ? "label"
    : "label label__hidden"}"
        >
            <slot
                ${slotted({ property: "defaultSlottedNodes", filter: whitespaceFilter })}
            ></slot>
        </label>
        <div class="root" part="root">
            ${startSlotTemplate(context, definition)}
            <input
                class="control"
                part="control"
                id="control"
                @input="${x => x.handleTextInput()}"
                @change="${x => x.handleChange()}"
                ?autofocus="${x => x.autofocus}"
                ?disabled="${x => x.disabled}"
                list="${x => x.list}"
                maxlength="${x => x.maxlength}"
                minlength="${x => x.minlength}"
                pattern="${x => x.pattern}"
                placeholder="${x => x.placeholder}"
                ?readonly="${x => x.readOnly}"
                ?required="${x => x.required}"
                size="${x => x.size}"
                ?spellcheck="${x => x.spellcheck}"
                :value="${x => x.value}"
                type="${x => x.type}"
                aria-atomic="${x => x.ariaAtomic}"
                aria-busy="${x => x.ariaBusy}"
                aria-controls="${x => x.ariaControls}"
                aria-current="${x => x.ariaCurrent}"
                aria-describedby="${x => x.ariaDescribedby}"
                aria-details="${x => x.ariaDetails}"
                aria-disabled="${x => x.ariaDisabled}"
                aria-errormessage="${x => x.ariaErrormessage}"
                aria-flowto="${x => x.ariaFlowto}"
                aria-haspopup="${x => x.ariaHaspopup}"
                aria-hidden="${x => x.ariaHidden}"
                aria-invalid="${x => x.ariaInvalid}"
                aria-keyshortcuts="${x => x.ariaKeyshortcuts}"
                aria-label="${x => x.ariaLabel}"
                aria-labelledby="${x => x.ariaLabelledby}"
                aria-live="${x => x.ariaLive}"
                aria-owns="${x => x.ariaOwns}"
                aria-relevant="${x => x.ariaRelevant}"
                aria-roledescription="${x => x.ariaRoledescription}"
                ${ref("control")}
            />
            ${endSlotTemplate(context, definition)}
        </div>
    </template>
`;

    class _TextField extends FoundationElement {
    }
    /**
     * A form-associated base class for the {@link @microsoft/fast-foundation#(TextField:class)} component.
     *
     * @internal
     */
    class FormAssociatedTextField extends FormAssociated(_TextField) {
        constructor() {
            super(...arguments);
            this.proxy = document.createElement("input");
        }
    }

    /**
     * Text field sub-types
     * @public
     */
    var TextFieldType;
    (function (TextFieldType) {
        /**
         * An email TextField
         */
        TextFieldType["email"] = "email";
        /**
         * A password TextField
         */
        TextFieldType["password"] = "password";
        /**
         * A telephone TextField
         */
        TextFieldType["tel"] = "tel";
        /**
         * A text TextField
         */
        TextFieldType["text"] = "text";
        /**
         * A URL TextField
         */
        TextFieldType["url"] = "url";
    })(TextFieldType || (TextFieldType = {}));

    /**
     * A Text Field Custom HTML Element.
     * Based largely on the {@link https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/text | <input type="text" /> element }.
     *
     * @public
     */
    class TextField$1 extends FormAssociatedTextField {
        constructor() {
            super(...arguments);
            /**
             * Allows setting a type or mode of text.
             * @public
             * @remarks
             * HTML Attribute: type
             */
            this.type = TextFieldType.text;
        }
        readOnlyChanged() {
            if (this.proxy instanceof HTMLInputElement) {
                this.proxy.readOnly = this.readOnly;
                this.validate();
            }
        }
        autofocusChanged() {
            if (this.proxy instanceof HTMLInputElement) {
                this.proxy.autofocus = this.autofocus;
                this.validate();
            }
        }
        placeholderChanged() {
            if (this.proxy instanceof HTMLInputElement) {
                this.proxy.placeholder = this.placeholder;
            }
        }
        typeChanged() {
            if (this.proxy instanceof HTMLInputElement) {
                this.proxy.type = this.type;
                this.validate();
            }
        }
        listChanged() {
            if (this.proxy instanceof HTMLInputElement) {
                this.proxy.setAttribute("list", this.list);
                this.validate();
            }
        }
        maxlengthChanged() {
            if (this.proxy instanceof HTMLInputElement) {
                this.proxy.maxLength = this.maxlength;
                this.validate();
            }
        }
        minlengthChanged() {
            if (this.proxy instanceof HTMLInputElement) {
                this.proxy.minLength = this.minlength;
                this.validate();
            }
        }
        patternChanged() {
            if (this.proxy instanceof HTMLInputElement) {
                this.proxy.pattern = this.pattern;
                this.validate();
            }
        }
        sizeChanged() {
            if (this.proxy instanceof HTMLInputElement) {
                this.proxy.size = this.size;
            }
        }
        spellcheckChanged() {
            if (this.proxy instanceof HTMLInputElement) {
                this.proxy.spellcheck = this.spellcheck;
            }
        }
        /**
         * @internal
         */
        connectedCallback() {
            super.connectedCallback();
            this.proxy.setAttribute("type", this.type);
            this.validate();
            if (this.autofocus) {
                DOM.queueUpdate(() => {
                    this.focus();
                });
            }
        }
        /**
         * Handles the internal control's `input` event
         * @internal
         */
        handleTextInput() {
            this.value = this.control.value;
        }
        /**
         * Change event handler for inner control.
         * @remarks
         * "Change" events are not `composable` so they will not
         * permeate the shadow DOM boundary. This fn effectively proxies
         * the change event, emitting a `change` event whenever the internal
         * control emits a `change` event
         * @internal
         */
        handleChange() {
            this.$emit("change");
        }
    }
    __decorate$1([
        attr({ attribute: "readonly", mode: "boolean" })
    ], TextField$1.prototype, "readOnly", void 0);
    __decorate$1([
        attr({ mode: "boolean" })
    ], TextField$1.prototype, "autofocus", void 0);
    __decorate$1([
        attr
    ], TextField$1.prototype, "placeholder", void 0);
    __decorate$1([
        attr
    ], TextField$1.prototype, "type", void 0);
    __decorate$1([
        attr
    ], TextField$1.prototype, "list", void 0);
    __decorate$1([
        attr({ converter: nullableNumberConverter })
    ], TextField$1.prototype, "maxlength", void 0);
    __decorate$1([
        attr({ converter: nullableNumberConverter })
    ], TextField$1.prototype, "minlength", void 0);
    __decorate$1([
        attr
    ], TextField$1.prototype, "pattern", void 0);
    __decorate$1([
        attr({ converter: nullableNumberConverter })
    ], TextField$1.prototype, "size", void 0);
    __decorate$1([
        attr({ mode: "boolean" })
    ], TextField$1.prototype, "spellcheck", void 0);
    __decorate$1([
        observable
    ], TextField$1.prototype, "defaultSlottedNodes", void 0);
    /**
     * Includes ARIA states and properties relating to the ARIA textbox role
     *
     * @public
     */
    class DelegatesARIATextbox {
    }
    applyMixins(DelegatesARIATextbox, ARIAGlobalStatesAndProperties);
    applyMixins(TextField$1, StartEnd, DelegatesARIATextbox);

    class _NumberField extends FoundationElement {
    }
    /**
     * A form-associated base class for the {@link @microsoft/fast-foundation#(NumberField:class)} component.
     *
     * @internal
     */
    class FormAssociatedNumberField extends FormAssociated(_NumberField) {
        constructor() {
            super(...arguments);
            this.proxy = document.createElement("input");
        }
    }

    /**
     * A Number Field Custom HTML Element.
     * Based largely on the {@link https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/number | <input type="number" /> element }.
     *
     * @public
     */
    class NumberField$1 extends FormAssociatedNumberField {
        constructor() {
            super(...arguments);
            /**
             * When true, spin buttons will not be rendered
             * @public
             * @remarks
             * HTML Attribute: autofocus
             */
            this.hideStep = false;
            /**
             * Amount to increment or decrement the value by
             * @public
             * @remarks
             * HTMLAttribute: step
             */
            this.step = 1;
            /**
             * Flag to indicate that the value change is from the user input
             * @internal
             */
            this.isUserInput = false;
        }
        /**
         * Ensures that the max is greater than the min and that the value
         *  is less than the max
         * @param previous - the previous max value
         * @param next - updated max value
         *
         * @internal
         */
        maxChanged(previous, next) {
            var _a;
            this.max = Math.max(next, (_a = this.min) !== null && _a !== void 0 ? _a : next);
            const min = Math.min(this.min, this.max);
            if (this.min !== undefined && this.min !== min) {
                this.min = min;
            }
            this.value = this.getValidValue(this.value);
        }
        /**
         * Ensures that the min is less than the max and that the value
         *  is greater than the min
         * @param previous - previous min value
         * @param next - updated min value
         *
         * @internal
         */
        minChanged(previous, next) {
            var _a;
            this.min = Math.min(next, (_a = this.max) !== null && _a !== void 0 ? _a : next);
            const max = Math.max(this.min, this.max);
            if (this.max !== undefined && this.max !== max) {
                this.max = max;
            }
            this.value = this.getValidValue(this.value);
        }
        /**
         * The value property, typed as a number.
         *
         * @public
         */
        get valueAsNumber() {
            return parseFloat(super.value);
        }
        set valueAsNumber(next) {
            this.value = next.toString();
        }
        /**
         * Validates that the value is a number between the min and max
         * @param previous - previous stored value
         * @param next - value being updated
         * @param updateControl - should the text field be updated with value, defaults to true
         * @internal
         */
        valueChanged(previous, next) {
            this.value = this.getValidValue(next);
            if (next !== this.value) {
                return;
            }
            if (this.control && !this.isUserInput) {
                this.control.value = this.value;
            }
            super.valueChanged(previous, this.value);
            if (previous !== undefined && !this.isUserInput) {
                this.$emit("input");
                this.$emit("change");
            }
            this.isUserInput = false;
        }
        /**
         * Sets the internal value to a valid number between the min and max properties
         * @param value - user input
         *
         * @internal
         */
        getValidValue(value) {
            var _a, _b;
            let validValue = parseFloat(parseFloat(value).toPrecision(12));
            if (isNaN(validValue)) {
                validValue = "";
            }
            else {
                validValue = Math.min(validValue, (_a = this.max) !== null && _a !== void 0 ? _a : validValue);
                validValue = Math.max(validValue, (_b = this.min) !== null && _b !== void 0 ? _b : validValue).toString();
            }
            return validValue;
        }
        /**
         * Increments the value using the step value
         *
         * @public
         */
        stepUp() {
            const value = parseFloat(this.value);
            const stepUpValue = !isNaN(value)
                ? value + this.step
                : this.min > 0
                    ? this.min
                    : this.max < 0
                        ? this.max
                        : !this.min
                            ? this.step
                            : 0;
            this.value = stepUpValue.toString();
        }
        /**
         * Decrements the value using the step value
         *
         * @public
         */
        stepDown() {
            const value = parseFloat(this.value);
            const stepDownValue = !isNaN(value)
                ? value - this.step
                : this.min > 0
                    ? this.min
                    : this.max < 0
                        ? this.max
                        : !this.min
                            ? 0 - this.step
                            : 0;
            this.value = stepDownValue.toString();
        }
        /**
         * Sets up the initial state of the number field
         * @internal
         */
        connectedCallback() {
            super.connectedCallback();
            this.proxy.setAttribute("type", "number");
            this.validate();
            this.control.value = this.value;
            if (this.autofocus) {
                DOM.queueUpdate(() => {
                    this.focus();
                });
            }
        }
        /**
         * Handles the internal control's `input` event
         * @internal
         */
        handleTextInput() {
            this.control.value = this.control.value.replace(/[^0-9\-+e.]/g, "");
            this.isUserInput = true;
            this.value = this.control.value;
        }
        /**
         * Change event handler for inner control.
         * @remarks
         * "Change" events are not `composable` so they will not
         * permeate the shadow DOM boundary. This fn effectively proxies
         * the change event, emitting a `change` event whenever the internal
         * control emits a `change` event
         * @internal
         */
        handleChange() {
            this.$emit("change");
        }
        /**
         * Handles the internal control's `keydown` event
         * @internal
         */
        handleKeyDown(e) {
            const key = e.key;
            switch (key) {
                case keyArrowUp:
                    this.stepUp();
                    return false;
                case keyArrowDown:
                    this.stepDown();
                    return false;
            }
            return true;
        }
        /**
         * Handles populating the input field with a validated value when
         *  leaving the input field.
         * @internal
         */
        handleBlur() {
            this.control.value = this.value;
        }
    }
    __decorate$1([
        attr({ attribute: "readonly", mode: "boolean" })
    ], NumberField$1.prototype, "readOnly", void 0);
    __decorate$1([
        attr({ mode: "boolean" })
    ], NumberField$1.prototype, "autofocus", void 0);
    __decorate$1([
        attr({ attribute: "hide-step", mode: "boolean" })
    ], NumberField$1.prototype, "hideStep", void 0);
    __decorate$1([
        attr
    ], NumberField$1.prototype, "placeholder", void 0);
    __decorate$1([
        attr
    ], NumberField$1.prototype, "list", void 0);
    __decorate$1([
        attr({ converter: nullableNumberConverter })
    ], NumberField$1.prototype, "maxlength", void 0);
    __decorate$1([
        attr({ converter: nullableNumberConverter })
    ], NumberField$1.prototype, "minlength", void 0);
    __decorate$1([
        attr({ converter: nullableNumberConverter })
    ], NumberField$1.prototype, "size", void 0);
    __decorate$1([
        attr({ converter: nullableNumberConverter })
    ], NumberField$1.prototype, "step", void 0);
    __decorate$1([
        attr({ converter: nullableNumberConverter })
    ], NumberField$1.prototype, "max", void 0);
    __decorate$1([
        attr({ converter: nullableNumberConverter })
    ], NumberField$1.prototype, "min", void 0);
    __decorate$1([
        observable
    ], NumberField$1.prototype, "defaultSlottedNodes", void 0);
    applyMixins(NumberField$1, StartEnd, DelegatesARIATextbox);

    class _Select extends Listbox {
    }
    /**
     * A form-associated base class for the {@link @microsoft/fast-foundation#(Select:class)} component.
     *
     * @internal
     */
    class FormAssociatedSelect extends FormAssociated(_Select) {
        constructor() {
            super(...arguments);
            this.proxy = document.createElement("select");
        }
    }

    /**
     * A Select Custom HTML Element.
     * Implements the {@link https://www.w3.org/TR/wai-aria-1.1/#select | ARIA select }.
     *
     * @public
     */
    class Select$1 extends FormAssociatedSelect {
        constructor() {
            super(...arguments);
            /**
             * The open attribute.
             *
             * @internal
             */
            this.open = false;
            /**
             * Indicates the initial state of the position attribute.
             *
             * @internal
             */
            this.forcedPosition = false;
            /**
             * Holds the current state for the calculated position of the listbox.
             *
             * @public
             */
            this.position = SelectPosition.below;
            /**
             * The unique id for the internal listbox element.
             *
             * @internal
             */
            this.listboxId = uniqueId("listbox-");
            /**
             * The max height for the listbox when opened.
             *
             * @internal
             */
            this.maxHeight = 0;
            /**
             * The value displayed on the button.
             *
             * @public
             */
            this.displayValue = "";
        }
        openChanged() {
            if (this.open) {
                this.ariaControls = this.listboxId;
                this.ariaExpanded = "true";
                this.setPositioning();
                this.focusAndScrollOptionIntoView();
                this.indexWhenOpened = this.selectedIndex;
                // focus is directed to the element when `open` is changed programmatically
                DOM.queueUpdate(() => this.focus());
                return;
            }
            this.ariaControls = "";
            this.ariaExpanded = "false";
        }
        /**
         * The value property.
         *
         * @public
         */
        get value() {
            Observable.track(this, "value");
            return this._value;
        }
        set value(next) {
            var _a;
            const prev = `${this._value}`;
            if ((_a = this.options) === null || _a === void 0 ? void 0 : _a.length) {
                const selectedIndex = this.options.findIndex(el => el.value === next);
                const prevSelectedOption = this.options[this.selectedIndex];
                const nextSelectedOption = this.options[selectedIndex];
                const prevSelectedValue = prevSelectedOption
                    ? prevSelectedOption.value
                    : null;
                const nextSelectedValue = nextSelectedOption
                    ? nextSelectedOption.value
                    : null;
                if (selectedIndex === -1 || prevSelectedValue !== nextSelectedValue) {
                    next = "";
                    this.selectedIndex = selectedIndex;
                }
                if (this.firstSelectedOption) {
                    next = this.firstSelectedOption.value;
                }
            }
            if (prev !== next) {
                this._value = next;
                super.valueChanged(prev, next);
                Observable.notify(this, "value");
            }
        }
        updateValue(shouldEmit) {
            if (this.$fastController.isConnected) {
                this.value = this.firstSelectedOption ? this.firstSelectedOption.value : "";
                this.displayValue = this.firstSelectedOption
                    ? this.firstSelectedOption.textContent || this.firstSelectedOption.value
                    : this.value;
            }
            if (shouldEmit) {
                this.$emit("input");
                this.$emit("change", this, {
                    bubbles: true,
                    composed: undefined,
                });
            }
        }
        /**
         * Updates the proxy value when the selected index changes.
         *
         * @param prev - the previous selected index
         * @param next - the next selected index
         *
         * @internal
         */
        selectedIndexChanged(prev, next) {
            super.selectedIndexChanged(prev, next);
            this.updateValue();
        }
        positionChanged() {
            this.positionAttribute = this.position;
            this.setPositioning();
        }
        /**
         * Calculate and apply listbox positioning based on available viewport space.
         *
         * @param force - direction to force the listbox to display
         * @public
         */
        setPositioning() {
            const currentBox = this.getBoundingClientRect();
            const viewportHeight = window.innerHeight;
            const availableBottom = viewportHeight - currentBox.bottom;
            this.position = this.forcedPosition
                ? this.positionAttribute
                : currentBox.top > availableBottom
                    ? SelectPosition.above
                    : SelectPosition.below;
            this.positionAttribute = this.forcedPosition
                ? this.positionAttribute
                : this.position;
            this.maxHeight =
                this.position === SelectPosition.above ? ~~currentBox.top : ~~availableBottom;
        }
        maxHeightChanged() {
            if (this.listbox) {
                this.listbox.style.setProperty("--max-height", `${this.maxHeight}px`);
            }
        }
        /**
         * Synchronize the `aria-disabled` property when the `disabled` property changes.
         *
         * @param prev - The previous disabled value
         * @param next - The next disabled value
         *
         * @internal
         */
        disabledChanged(prev, next) {
            if (super.disabledChanged) {
                super.disabledChanged(prev, next);
            }
            this.ariaDisabled = this.disabled ? "true" : "false";
        }
        /**
         * Reset the element to its first selectable option when its parent form is reset.
         *
         * @internal
         */
        formResetCallback() {
            this.setProxyOptions();
            // Call the base class's implementation setDefaultSelectedOption instead of the select's
            // override, in order to reset the selectedIndex without using the value property.
            super.setDefaultSelectedOption();
            if (this.selectedIndex === -1) {
                this.selectedIndex = 0;
            }
        }
        /**
         * Handle opening and closing the listbox when the select is clicked.
         *
         * @param e - the mouse event
         * @internal
         */
        clickHandler(e) {
            // do nothing if the select is disabled
            if (this.disabled) {
                return;
            }
            if (this.open) {
                const captured = e.target.closest(`option,[role=option]`);
                if (captured && captured.disabled) {
                    return;
                }
            }
            super.clickHandler(e);
            this.open = !this.open;
            if (!this.open && this.indexWhenOpened !== this.selectedIndex) {
                this.updateValue(true);
            }
            return true;
        }
        /**
         * Handle focus state when the element or its children lose focus.
         *
         * @param e - The focus event
         * @internal
         */
        focusoutHandler(e) {
            var _a;
            if (!this.open) {
                return true;
            }
            const focusTarget = e.relatedTarget;
            if (this.isSameNode(focusTarget)) {
                this.focus();
                return;
            }
            if (!((_a = this.options) === null || _a === void 0 ? void 0 : _a.includes(focusTarget))) {
                this.open = false;
                if (this.indexWhenOpened !== this.selectedIndex) {
                    this.updateValue(true);
                }
            }
        }
        /**
         * Synchronize the form-associated proxy and update the value property of the element.
         *
         * @param prev - the previous collection of slotted option elements
         * @param next - the next collection of slotted option elements
         *
         * @internal
         */
        slottedOptionsChanged(prev, next) {
            super.slottedOptionsChanged(prev, next);
            this.setProxyOptions();
            this.updateValue();
        }
        setDefaultSelectedOption() {
            var _a;
            const options = (_a = this.options) !== null && _a !== void 0 ? _a : Array.from(this.children).filter(Listbox.slottedOptionFilter);
            const selectedIndex = options === null || options === void 0 ? void 0 : options.findIndex(el => el.hasAttribute("selected") || el.selected || el.value === this.value);
            if (selectedIndex !== -1) {
                this.selectedIndex = selectedIndex;
                return;
            }
            this.selectedIndex = 0;
        }
        /**
         * Reset and fill the proxy to match the component's options.
         *
         * @internal
         */
        setProxyOptions() {
            if (this.proxy instanceof HTMLSelectElement && this.options) {
                this.proxy.options.length = 0;
                this.options.forEach(option => {
                    const proxyOption = option.proxy ||
                        (option instanceof HTMLOptionElement ? option.cloneNode() : null);
                    if (proxyOption) {
                        this.proxy.appendChild(proxyOption);
                    }
                });
            }
        }
        /**
         * Handle keyboard interaction for the select.
         *
         * @param e - the keyboard event
         * @internal
         */
        keydownHandler(e) {
            super.keydownHandler(e);
            const key = e.key || e.key.charCodeAt(0);
            switch (key) {
                case " ": {
                    if (this.typeaheadExpired) {
                        e.preventDefault();
                        this.open = !this.open;
                    }
                    break;
                }
                case "Enter": {
                    e.preventDefault();
                    this.open = !this.open;
                    break;
                }
                case "Escape": {
                    if (this.open) {
                        e.preventDefault();
                        this.open = false;
                    }
                    break;
                }
                case "Tab": {
                    if (!this.open) {
                        return true;
                    }
                    e.preventDefault();
                    this.open = false;
                }
            }
            if (!this.open && this.indexWhenOpened !== this.selectedIndex) {
                this.updateValue(true);
                this.indexWhenOpened = this.selectedIndex;
            }
            return true;
        }
        connectedCallback() {
            super.connectedCallback();
            this.forcedPosition = !!this.positionAttribute;
        }
    }
    __decorate$1([
        attr({ attribute: "open", mode: "boolean" })
    ], Select$1.prototype, "open", void 0);
    __decorate$1([
        attr({ attribute: "position" })
    ], Select$1.prototype, "positionAttribute", void 0);
    __decorate$1([
        observable
    ], Select$1.prototype, "position", void 0);
    __decorate$1([
        observable
    ], Select$1.prototype, "maxHeight", void 0);
    __decorate$1([
        observable
    ], Select$1.prototype, "displayValue", void 0);
    /**
     * Includes ARIA states and properties relating to the ARIA select role.
     *
     * @public
     */
    class DelegatesARIASelect {
    }
    __decorate$1([
        observable
    ], DelegatesARIASelect.prototype, "ariaControls", void 0);
    applyMixins(DelegatesARIASelect, DelegatesARIAListbox);
    applyMixins(Select$1, StartEnd, DelegatesARIASelect);

    /**
     * The template for the {@link @microsoft/fast-foundation#(Select:class)} component.
     * @public
     */
    const selectTemplate = (context, definition) => html `
    <template
        class="${x => (x.open ? "open" : "")} ${x => x.disabled ? "disabled" : ""} ${x => x.position}"
        aria-activedescendant="${x => x.ariaActiveDescendant}"
        aria-controls="${x => x.ariaControls}"
        aria-disabled="${x => x.ariaDisabled}"
        aria-expanded="${x => x.ariaExpanded}"
        aria-haspopup="listbox"
        ?open="${x => x.open}"
        role="combobox"
        tabindex="${x => (!x.disabled ? "0" : null)}"
        @click="${(x, c) => x.clickHandler(c.event)}"
        @focusout="${(x, c) => x.focusoutHandler(c.event)}"
        @keydown="${(x, c) => x.keydownHandler(c.event)}"
    >
        <div class="control" part="control" ?disabled="${x => x.disabled}">
            ${startSlotTemplate(context, definition)}
            <slot name="button-container">
                <div class="selected-value" part="selected-value">
                    <slot name="selected-value">${x => x.displayValue}</slot>
                </div>
                <div aria-hidden="true" class="indicator" part="indicator">
                    <slot name="indicator">
                        ${definition.indicator || ""}
                    </slot>
                </div>
            </slot>
            ${endSlotTemplate(context, definition)}
        </div>
        <div
            class="listbox"
            id="${x => x.listboxId}"
            part="listbox"
            role="listbox"
            ?disabled="${x => x.disabled}"
            ?hidden="${x => !x.open}"
            ${ref("listbox")}
        >
            <slot
                ${slotted({
    filter: Listbox.slottedOptionFilter,
    flatten: true,
    property: "slottedOptions",
})}
            ></slot>
        </div>
    </template>
`;

    class _Switch extends FoundationElement {
    }
    /**
     * A form-associated base class for the {@link @microsoft/fast-foundation#(Switch:class)} component.
     *
     * @internal
     */
    class FormAssociatedSwitch extends CheckableFormAssociated(_Switch) {
        constructor() {
            super(...arguments);
            this.proxy = document.createElement("input");
        }
    }

    /**
     * A Switch Custom HTML Element.
     * Implements the {@link https://www.w3.org/TR/wai-aria-1.1/#switch | ARIA switch }.
     *
     * @public
     */
    class Switch$1 extends FormAssociatedSwitch {
        constructor() {
            super();
            /**
             * The element's value to be included in form submission when checked.
             * Default to "on" to reach parity with input[type="checkbox"]
             *
             * @internal
             */
            this.initialValue = "on";
            /**
             * @internal
             */
            this.keypressHandler = (e) => {
                switch (e.key) {
                    case keyEnter:
                    case keySpace:
                        this.checked = !this.checked;
                        break;
                }
            };
            /**
             * @internal
             */
            this.clickHandler = (e) => {
                if (!this.disabled && !this.readOnly) {
                    this.checked = !this.checked;
                }
            };
            this.proxy.setAttribute("type", "checkbox");
        }
        readOnlyChanged() {
            if (this.proxy instanceof HTMLInputElement) {
                this.proxy.readOnly = this.readOnly;
            }
            this.readOnly
                ? this.classList.add("readonly")
                : this.classList.remove("readonly");
        }
        /**
         * @internal
         */
        checkedChanged(prev, next) {
            super.checkedChanged(prev, next);
            /**
             * @deprecated - this behavior already exists in the template and should not exist in the class.
             */
            this.checked ? this.classList.add("checked") : this.classList.remove("checked");
        }
    }
    __decorate$1([
        attr({ attribute: "readonly", mode: "boolean" })
    ], Switch$1.prototype, "readOnly", void 0);
    __decorate$1([
        observable
    ], Switch$1.prototype, "defaultSlottedNodes", void 0);

    /**
     * The template for the {@link @microsoft/fast-foundation#TabPanel} component.
     * @public
     */
    const tabPanelTemplate = (context, definition) => html `
    <template slot="tabpanel" role="tabpanel">
        <slot></slot>
    </template>
`;

    /**
     * A TabPanel Component to be used with {@link @microsoft/fast-foundation#(Tabs:class)}
     * @public
     */
    class TabPanel$1 extends FoundationElement {
    }

    /**
     * The template for the {@link @microsoft/fast-foundation#Tab} component.
     * @public
     */
    const tabTemplate = (context, definition) => html `
    <template slot="tab" role="tab" aria-disabled="${x => x.disabled}">
        <slot></slot>
    </template>
`;

    /**
     * A Tab Component to be used with {@link @microsoft/fast-foundation#(Tabs:class)}
     * @public
     */
    class Tab$1 extends FoundationElement {
    }
    __decorate$1([
        attr({ mode: "boolean" })
    ], Tab$1.prototype, "disabled", void 0);

    /**
     * The template for the {@link @microsoft/fast-foundation#(Tabs:class)} component.
     * @public
     */
    const tabsTemplate = (context, definition) => html `
    <template class="${x => x.orientation}">
        ${startSlotTemplate(context, definition)}
        <div class="tablist" part="tablist" role="tablist">
            <slot class="tab" name="tab" part="tab" ${slotted("tabs")}></slot>

            ${when(x => x.showActiveIndicator, html `
                    <div
                        ${ref("activeIndicatorRef")}
                        class="activeIndicator"
                        part="activeIndicator"
                    ></div>
                `)}
        </div>
        ${endSlotTemplate(context, definition)}
        <div class="tabpanel">
            <slot name="tabpanel" part="tabpanel" ${slotted("tabpanels")}></slot>
        </div>
    </template>
`;

    /**
     * The orientation of the {@link @microsoft/fast-foundation#(Tabs:class)} component
     * @public
     */
    var TabsOrientation;
    (function (TabsOrientation) {
        TabsOrientation["vertical"] = "vertical";
        TabsOrientation["horizontal"] = "horizontal";
    })(TabsOrientation || (TabsOrientation = {}));
    /**
     * A Tabs Custom HTML Element.
     * Implements the {@link https://www.w3.org/TR/wai-aria-1.1/#tablist | ARIA tablist }.
     *
     * @public
     */
    class Tabs$1 extends FoundationElement {
        constructor() {
            super(...arguments);
            /**
             * The orientation
             * @public
             * @remarks
             * HTML Attribute: orientation
             */
            this.orientation = TabsOrientation.horizontal;
            /**
             * Whether or not to show the active indicator
             * @public
             * @remarks
             * HTML Attribute: activeindicator
             */
            this.activeindicator = true;
            /**
             * @internal
             */
            this.showActiveIndicator = true;
            this.prevActiveTabIndex = 0;
            this.activeTabIndex = 0;
            this.ticking = false;
            this.change = () => {
                this.$emit("change", this.activetab);
            };
            this.isDisabledElement = (el) => {
                return el.getAttribute("aria-disabled") === "true";
            };
            this.isFocusableElement = (el) => {
                return !this.isDisabledElement(el);
            };
            this.setTabs = () => {
                const gridHorizontalProperty = "gridColumn";
                const gridVerticalProperty = "gridRow";
                const gridProperty = this.isHorizontal()
                    ? gridHorizontalProperty
                    : gridVerticalProperty;
                this.tabIds = this.getTabIds();
                this.tabpanelIds = this.getTabPanelIds();
                this.activeTabIndex = this.getActiveIndex();
                this.showActiveIndicator = false;
                this.tabs.forEach((tab, index) => {
                    if (tab.slot === "tab") {
                        const isActiveTab = this.activeTabIndex === index && this.isFocusableElement(tab);
                        if (this.activeindicator && this.isFocusableElement(tab)) {
                            this.showActiveIndicator = true;
                        }
                        const tabId = this.tabIds[index];
                        const tabpanelId = this.tabpanelIds[index];
                        tab.setAttribute("id", typeof tabId !== "string" ? `tab-${index + 1}` : tabId);
                        tab.setAttribute("aria-selected", isActiveTab ? "true" : "false");
                        tab.setAttribute("aria-controls", typeof tabpanelId !== "string" ? `panel-${index + 1}` : tabpanelId);
                        tab.addEventListener("click", this.handleTabClick);
                        tab.addEventListener("keydown", this.handleTabKeyDown);
                        tab.setAttribute("tabindex", isActiveTab ? "0" : "-1");
                        if (isActiveTab) {
                            this.activetab = tab;
                        }
                    }
                    // If the original property isn't emptied out,
                    // the next set will morph into a grid-area style setting that is not what we want
                    tab.style[gridHorizontalProperty] = "";
                    tab.style[gridVerticalProperty] = "";
                    tab.style[gridProperty] = `${index + 1}`;
                    !this.isHorizontal()
                        ? tab.classList.add("vertical")
                        : tab.classList.remove("vertical");
                });
            };
            this.setTabPanels = () => {
                this.tabIds = this.getTabIds();
                this.tabpanelIds = this.getTabPanelIds();
                this.tabpanels.forEach((tabpanel, index) => {
                    const tabId = this.tabIds[index];
                    const tabpanelId = this.tabpanelIds[index];
                    tabpanel.setAttribute("id", typeof tabpanelId !== "string" ? `panel-${index + 1}` : tabpanelId);
                    tabpanel.setAttribute("aria-labelledby", typeof tabId !== "string" ? `tab-${index + 1}` : tabId);
                    this.activeTabIndex !== index
                        ? tabpanel.setAttribute("hidden", "")
                        : tabpanel.removeAttribute("hidden");
                });
            };
            this.handleTabClick = (event) => {
                const selectedTab = event.currentTarget;
                if (selectedTab.nodeType === 1 && this.isFocusableElement(selectedTab)) {
                    this.prevActiveTabIndex = this.activeTabIndex;
                    this.activeTabIndex = this.tabs.indexOf(selectedTab);
                    this.setComponent();
                }
            };
            this.handleTabKeyDown = (event) => {
                if (this.isHorizontal()) {
                    switch (event.key) {
                        case keyArrowLeft:
                            event.preventDefault();
                            this.adjustBackward(event);
                            break;
                        case keyArrowRight:
                            event.preventDefault();
                            this.adjustForward(event);
                            break;
                    }
                }
                else {
                    switch (event.key) {
                        case keyArrowUp:
                            event.preventDefault();
                            this.adjustBackward(event);
                            break;
                        case keyArrowDown:
                            event.preventDefault();
                            this.adjustForward(event);
                            break;
                    }
                }
                switch (event.key) {
                    case keyHome:
                        event.preventDefault();
                        this.adjust(-this.activeTabIndex);
                        break;
                    case keyEnd:
                        event.preventDefault();
                        this.adjust(this.tabs.length - this.activeTabIndex - 1);
                        break;
                }
            };
            this.adjustForward = (e) => {
                const group = this.tabs;
                let index = 0;
                index = this.activetab ? group.indexOf(this.activetab) + 1 : 1;
                if (index === group.length) {
                    index = 0;
                }
                while (index < group.length && group.length > 1) {
                    if (this.isFocusableElement(group[index])) {
                        this.moveToTabByIndex(group, index);
                        break;
                    }
                    else if (this.activetab && index === group.indexOf(this.activetab)) {
                        break;
                    }
                    else if (index + 1 >= group.length) {
                        index = 0;
                    }
                    else {
                        index += 1;
                    }
                }
            };
            this.adjustBackward = (e) => {
                const group = this.tabs;
                let index = 0;
                index = this.activetab ? group.indexOf(this.activetab) - 1 : 0;
                index = index < 0 ? group.length - 1 : index;
                while (index >= 0 && group.length > 1) {
                    if (this.isFocusableElement(group[index])) {
                        this.moveToTabByIndex(group, index);
                        break;
                    }
                    else if (index - 1 < 0) {
                        index = group.length - 1;
                    }
                    else {
                        index -= 1;
                    }
                }
            };
            this.moveToTabByIndex = (group, index) => {
                const tab = group[index];
                this.activetab = tab;
                this.prevActiveTabIndex = this.activeTabIndex;
                this.activeTabIndex = index;
                tab.focus();
                this.setComponent();
            };
        }
        /**
         * @internal
         */
        orientationChanged() {
            if (this.$fastController.isConnected) {
                this.setTabs();
                this.setTabPanels();
                this.handleActiveIndicatorPosition();
            }
        }
        /**
         * @internal
         */
        activeidChanged(oldValue, newValue) {
            if (this.$fastController.isConnected &&
                this.tabs.length <= this.tabpanels.length) {
                this.prevActiveTabIndex = this.tabs.findIndex((item) => item.id === oldValue);
                this.setTabs();
                this.setTabPanels();
                this.handleActiveIndicatorPosition();
            }
        }
        /**
         * @internal
         */
        tabsChanged() {
            if (this.$fastController.isConnected &&
                this.tabs.length <= this.tabpanels.length) {
                this.setTabs();
                this.setTabPanels();
                this.handleActiveIndicatorPosition();
            }
        }
        /**
         * @internal
         */
        tabpanelsChanged() {
            if (this.$fastController.isConnected &&
                this.tabpanels.length <= this.tabs.length) {
                this.setTabs();
                this.setTabPanels();
                this.handleActiveIndicatorPosition();
            }
        }
        getActiveIndex() {
            const id = this.activeid;
            if (id !== undefined) {
                return this.tabIds.indexOf(this.activeid) === -1
                    ? 0
                    : this.tabIds.indexOf(this.activeid);
            }
            else {
                return 0;
            }
        }
        getTabIds() {
            return this.tabs.map((tab) => {
                return tab.getAttribute("id");
            });
        }
        getTabPanelIds() {
            return this.tabpanels.map((tabPanel) => {
                return tabPanel.getAttribute("id");
            });
        }
        setComponent() {
            if (this.activeTabIndex !== this.prevActiveTabIndex) {
                this.activeid = this.tabIds[this.activeTabIndex];
                this.focusTab();
                this.change();
            }
        }
        isHorizontal() {
            return this.orientation === TabsOrientation.horizontal;
        }
        handleActiveIndicatorPosition() {
            // Ignore if we click twice on the same tab
            if (this.showActiveIndicator &&
                this.activeindicator &&
                this.activeTabIndex !== this.prevActiveTabIndex) {
                if (this.ticking) {
                    this.ticking = false;
                }
                else {
                    this.ticking = true;
                    this.animateActiveIndicator();
                }
            }
        }
        animateActiveIndicator() {
            this.ticking = true;
            const gridProperty = this.isHorizontal() ? "gridColumn" : "gridRow";
            const translateProperty = this.isHorizontal()
                ? "translateX"
                : "translateY";
            const offsetProperty = this.isHorizontal() ? "offsetLeft" : "offsetTop";
            const prev = this.activeIndicatorRef[offsetProperty];
            this.activeIndicatorRef.style[gridProperty] = `${this.activeTabIndex + 1}`;
            const next = this.activeIndicatorRef[offsetProperty];
            this.activeIndicatorRef.style[gridProperty] = `${this.prevActiveTabIndex + 1}`;
            const dif = next - prev;
            this.activeIndicatorRef.style.transform = `${translateProperty}(${dif}px)`;
            this.activeIndicatorRef.classList.add("activeIndicatorTransition");
            this.activeIndicatorRef.addEventListener("transitionend", () => {
                this.ticking = false;
                this.activeIndicatorRef.style[gridProperty] = `${this.activeTabIndex + 1}`;
                this.activeIndicatorRef.style.transform = `${translateProperty}(0px)`;
                this.activeIndicatorRef.classList.remove("activeIndicatorTransition");
            });
        }
        /**
         * The adjust method for FASTTabs
         * @public
         * @remarks
         * This method allows the active index to be adjusted by numerical increments
         */
        adjust(adjustment) {
            this.prevActiveTabIndex = this.activeTabIndex;
            this.activeTabIndex = wrapInBounds(0, this.tabs.length - 1, this.activeTabIndex + adjustment);
            this.setComponent();
        }
        focusTab() {
            this.tabs[this.activeTabIndex].focus();
        }
        /**
         * @internal
         */
        connectedCallback() {
            super.connectedCallback();
            this.tabIds = this.getTabIds();
            this.tabpanelIds = this.getTabPanelIds();
            this.activeTabIndex = this.getActiveIndex();
        }
    }
    __decorate$1([
        attr
    ], Tabs$1.prototype, "orientation", void 0);
    __decorate$1([
        attr
    ], Tabs$1.prototype, "activeid", void 0);
    __decorate$1([
        observable
    ], Tabs$1.prototype, "tabs", void 0);
    __decorate$1([
        observable
    ], Tabs$1.prototype, "tabpanels", void 0);
    __decorate$1([
        attr({ mode: "boolean" })
    ], Tabs$1.prototype, "activeindicator", void 0);
    __decorate$1([
        observable
    ], Tabs$1.prototype, "activeIndicatorRef", void 0);
    __decorate$1([
        observable
    ], Tabs$1.prototype, "showActiveIndicator", void 0);
    applyMixins(Tabs$1, StartEnd);

    class _TextArea extends FoundationElement {
    }
    /**
     * A form-associated base class for the {@link @microsoft/fast-foundation#(TextArea:class)} component.
     *
     * @internal
     */
    class FormAssociatedTextArea extends FormAssociated(_TextArea) {
        constructor() {
            super(...arguments);
            this.proxy = document.createElement("textarea");
        }
    }

    /**
     * Resize mode for a TextArea
     * @public
     */
    var TextAreaResize;
    (function (TextAreaResize) {
        /**
         * No resize.
         */
        TextAreaResize["none"] = "none";
        /**
         * Resize vertically and horizontally.
         */
        TextAreaResize["both"] = "both";
        /**
         * Resize horizontally.
         */
        TextAreaResize["horizontal"] = "horizontal";
        /**
         * Resize vertically.
         */
        TextAreaResize["vertical"] = "vertical";
    })(TextAreaResize || (TextAreaResize = {}));

    /**
     * A Text Area Custom HTML Element.
     * Based largely on the {@link https://developer.mozilla.org/en-US/docs/Web/HTML/Element/textarea | <textarea> element }.
     *
     * @public
     */
    class TextArea$1 extends FormAssociatedTextArea {
        constructor() {
            super(...arguments);
            /**
             * The resize mode of the element.
             * @public
             * @remarks
             * HTML Attribute: resize
             */
            this.resize = TextAreaResize.none;
            /**
             * Sizes the element horizontally by a number of character columns.
             *
             * @public
             * @remarks
             * HTML Attribute: cols
             */
            this.cols = 20;
            /**
             * @internal
             */
            this.handleTextInput = () => {
                this.value = this.control.value;
            };
        }
        readOnlyChanged() {
            if (this.proxy instanceof HTMLTextAreaElement) {
                this.proxy.readOnly = this.readOnly;
            }
        }
        autofocusChanged() {
            if (this.proxy instanceof HTMLTextAreaElement) {
                this.proxy.autofocus = this.autofocus;
            }
        }
        listChanged() {
            if (this.proxy instanceof HTMLTextAreaElement) {
                this.proxy.setAttribute("list", this.list);
            }
        }
        maxlengthChanged() {
            if (this.proxy instanceof HTMLTextAreaElement) {
                this.proxy.maxLength = this.maxlength;
            }
        }
        minlengthChanged() {
            if (this.proxy instanceof HTMLTextAreaElement) {
                this.proxy.minLength = this.minlength;
            }
        }
        spellcheckChanged() {
            if (this.proxy instanceof HTMLTextAreaElement) {
                this.proxy.spellcheck = this.spellcheck;
            }
        }
        /**
         * Change event handler for inner control.
         * @remarks
         * "Change" events are not `composable` so they will not
         * permeate the shadow DOM boundary. This fn effectively proxies
         * the change event, emitting a `change` event whenever the internal
         * control emits a `change` event
         * @internal
         */
        handleChange() {
            this.$emit("change");
        }
    }
    __decorate$1([
        attr({ mode: "boolean" })
    ], TextArea$1.prototype, "readOnly", void 0);
    __decorate$1([
        attr
    ], TextArea$1.prototype, "resize", void 0);
    __decorate$1([
        attr({ mode: "boolean" })
    ], TextArea$1.prototype, "autofocus", void 0);
    __decorate$1([
        attr({ attribute: "form" })
    ], TextArea$1.prototype, "formId", void 0);
    __decorate$1([
        attr
    ], TextArea$1.prototype, "list", void 0);
    __decorate$1([
        attr({ converter: nullableNumberConverter })
    ], TextArea$1.prototype, "maxlength", void 0);
    __decorate$1([
        attr({ converter: nullableNumberConverter })
    ], TextArea$1.prototype, "minlength", void 0);
    __decorate$1([
        attr
    ], TextArea$1.prototype, "name", void 0);
    __decorate$1([
        attr
    ], TextArea$1.prototype, "placeholder", void 0);
    __decorate$1([
        attr({ converter: nullableNumberConverter, mode: "fromView" })
    ], TextArea$1.prototype, "cols", void 0);
    __decorate$1([
        attr({ converter: nullableNumberConverter, mode: "fromView" })
    ], TextArea$1.prototype, "rows", void 0);
    __decorate$1([
        attr({ mode: "boolean" })
    ], TextArea$1.prototype, "spellcheck", void 0);
    __decorate$1([
        observable
    ], TextArea$1.prototype, "defaultSlottedNodes", void 0);
    applyMixins(TextArea$1, DelegatesARIATextbox);

    /**
     * The template for the {@link @microsoft/fast-foundation#(TextArea:class)} component.
     * @public
     */
    const textAreaTemplate = (context, definition) => html `
    <template
        class="
            ${x => (x.readOnly ? "readonly" : "")}
            ${x => (x.resize !== TextAreaResize.none ? `resize-${x.resize}` : "")}"
    >
        <label
            part="label"
            for="control"
            class="${x => x.defaultSlottedNodes && x.defaultSlottedNodes.length
    ? "label"
    : "label label__hidden"}"
        >
            <slot ${slotted("defaultSlottedNodes")}></slot>
        </label>
        <textarea
            part="control"
            class="control"
            id="control"
            ?autofocus="${x => x.autofocus}"
            cols="${x => x.cols}"
            ?disabled="${x => x.disabled}"
            form="${x => x.form}"
            list="${x => x.list}"
            maxlength="${x => x.maxlength}"
            minlength="${x => x.minlength}"
            name="${x => x.name}"
            placeholder="${x => x.placeholder}"
            ?readonly="${x => x.readOnly}"
            ?required="${x => x.required}"
            rows="${x => x.rows}"
            ?spellcheck="${x => x.spellcheck}"
            :value="${x => x.value}"
            aria-atomic="${x => x.ariaAtomic}"
            aria-busy="${x => x.ariaBusy}"
            aria-controls="${x => x.ariaControls}"
            aria-current="${x => x.ariaCurrent}"
            aria-describedby="${x => x.ariaDescribedby}"
            aria-details="${x => x.ariaDetails}"
            aria-disabled="${x => x.ariaDisabled}"
            aria-errormessage="${x => x.ariaErrormessage}"
            aria-flowto="${x => x.ariaFlowto}"
            aria-haspopup="${x => x.ariaHaspopup}"
            aria-hidden="${x => x.ariaHidden}"
            aria-invalid="${x => x.ariaInvalid}"
            aria-keyshortcuts="${x => x.ariaKeyshortcuts}"
            aria-label="${x => x.ariaLabel}"
            aria-labelledby="${x => x.ariaLabelledby}"
            aria-live="${x => x.ariaLive}"
            aria-owns="${x => x.ariaOwns}"
            aria-relevant="${x => x.ariaRelevant}"
            aria-roledescription="${x => x.ariaRoledescription}"
            @input="${(x, c) => x.handleTextInput()}"
            @change="${x => x.handleChange()}"
            ${ref("control")}
        ></textarea>
    </template>
`;

    /**
     * The template for the {@link @microsoft/fast-foundation#(TreeItem:class)} component.
     * @public
     */
    const treeItemTemplate = (context, definition) => html `
    <template
        role="treeitem"
        slot="${x => (x.isNestedItem() ? "item" : void 0)}"
        tabindex="-1"
        class="${x => (x.expanded ? "expanded" : "")} ${x => x.selected ? "selected" : ""} ${x => (x.nested ? "nested" : "")}
            ${x => (x.disabled ? "disabled" : "")}"
        aria-expanded="${x => x.childItems && x.childItemLength() > 0 ? x.expanded : void 0}"
        aria-selected="${x => x.selected}"
        aria-disabled="${x => x.disabled}"
        @focusin="${(x, c) => x.handleFocus(c.event)}"
        @focusout="${(x, c) => x.handleBlur(c.event)}"
        ${children({
    property: "childItems",
    filter: elements(),
})}
    >
        <div class="positioning-region" part="positioning-region">
            <div class="content-region" part="content-region">
                ${when(x => x.childItems && x.childItemLength() > 0, html `
                        <div
                            aria-hidden="true"
                            class="expand-collapse-button"
                            part="expand-collapse-button"
                            @click="${(x, c) => x.handleExpandCollapseButtonClick(c.event)}"
                            ${ref("expandCollapseButton")}
                        >
                            <slot name="expand-collapse-glyph">
                                ${definition.expandCollapseGlyph || ""}
                            </slot>
                        </div>
                    `)}
                ${startSlotTemplate(context, definition)}
                <slot></slot>
                ${endSlotTemplate(context, definition)}
            </div>
        </div>
        ${when(x => x.childItems &&
    x.childItemLength() > 0 &&
    (x.expanded || x.renderCollapsedChildren), html `
                <div role="group" class="items" part="items">
                    <slot name="item" ${slotted("items")}></slot>
                </div>
            `)}
    </template>
`;

    /**
     * check if the item is a tree item
     * @public
     * @remarks
     * determines if element is an HTMLElement and if it has the role treeitem
     */
    function isTreeItemElement(el) {
        return isHTMLElement(el) && el.getAttribute("role") === "treeitem";
    }
    /**
     * A Tree item Custom HTML Element.
     *
     * @public
     */
    class TreeItem$1 extends FoundationElement {
        constructor() {
            super(...arguments);
            /**
             * When true, the control will be appear expanded by user interaction.
             * @public
             * @remarks
             * HTML Attribute: expanded
             */
            this.expanded = false;
            /**
             * Whether the item is focusable
             *
             * @internal
             */
            this.focusable = false;
            /**
             * Whether the tree is nested
             *
             * @public
             */
            this.isNestedItem = () => {
                return isTreeItemElement(this.parentElement);
            };
            /**
             * Handle expand button click
             *
             * @internal
             */
            this.handleExpandCollapseButtonClick = (e) => {
                if (!this.disabled && !e.defaultPrevented) {
                    this.expanded = !this.expanded;
                }
            };
            /**
             * Handle focus events
             *
             * @internal
             */
            this.handleFocus = (e) => {
                this.setAttribute("tabindex", "0");
            };
            /**
             * Handle blur events
             *
             * @internal
             */
            this.handleBlur = (e) => {
                this.setAttribute("tabindex", "-1");
            };
        }
        expandedChanged() {
            if (this.$fastController.isConnected) {
                this.$emit("expanded-change", this);
            }
        }
        selectedChanged() {
            if (this.$fastController.isConnected) {
                this.$emit("selected-change", this);
            }
        }
        itemsChanged(oldValue, newValue) {
            if (this.$fastController.isConnected) {
                this.items.forEach((node) => {
                    if (isTreeItemElement(node)) {
                        // TODO: maybe not require it to be a TreeItem?
                        node.nested = true;
                    }
                });
            }
        }
        /**
         * Places document focus on a tree item
         *
         * @public
         * @param el - the element to focus
         */
        static focusItem(el) {
            el.focusable = true;
            el.focus();
        }
        /**
         * Gets number of children
         *
         * @internal
         */
        childItemLength() {
            const treeChildren = this.childItems.filter((item) => {
                return isTreeItemElement(item);
            });
            return treeChildren ? treeChildren.length : 0;
        }
    }
    __decorate$1([
        attr({ mode: "boolean" })
    ], TreeItem$1.prototype, "expanded", void 0);
    __decorate$1([
        attr({ mode: "boolean" })
    ], TreeItem$1.prototype, "selected", void 0);
    __decorate$1([
        attr({ mode: "boolean" })
    ], TreeItem$1.prototype, "disabled", void 0);
    __decorate$1([
        observable
    ], TreeItem$1.prototype, "focusable", void 0);
    __decorate$1([
        observable
    ], TreeItem$1.prototype, "childItems", void 0);
    __decorate$1([
        observable
    ], TreeItem$1.prototype, "items", void 0);
    __decorate$1([
        observable
    ], TreeItem$1.prototype, "nested", void 0);
    __decorate$1([
        observable
    ], TreeItem$1.prototype, "renderCollapsedChildren", void 0);
    applyMixins(TreeItem$1, StartEnd);

    /**
     * The template for the {@link @microsoft/fast-foundation#TreeView} component.
     * @public
     */
    const treeViewTemplate = (context, definition) => html `
    <template
        role="tree"
        ${ref("treeView")}
        @keydown="${(x, c) => x.handleKeyDown(c.event)}"
        @focusin="${(x, c) => x.handleFocus(c.event)}"
        @focusout="${(x, c) => x.handleBlur(c.event)}"
        @click="${(x, c) => x.handleClick(c.event)}"
        @selected-change="${(x, c) => x.handleSelectedChange(c.event)}"
    >
        <slot ${slotted("slottedTreeItems")}></slot>
    </template>
`;

    /**
     * A Tree view Custom HTML Element.
     * Implements the {@link https://w3c.github.io/aria-practices/#TreeView | ARIA TreeView }.
     *
     * @public
     */
    class TreeView$1 extends FoundationElement {
        constructor() {
            super(...arguments);
            /**
             * The tree item that is designated to be in the tab queue.
             *
             * @internal
             */
            this.currentFocused = null;
            /**
             * Handle focus events
             *
             * @internal
             */
            this.handleFocus = (e) => {
                if (this.slottedTreeItems.length < 1) {
                    // no child items, nothing to do
                    return;
                }
                if (e.target === this) {
                    if (this.currentFocused === null) {
                        this.currentFocused = this.getValidFocusableItem();
                    }
                    if (this.currentFocused !== null) {
                        TreeItem$1.focusItem(this.currentFocused);
                    }
                    return;
                }
                if (this.contains(e.target)) {
                    this.setAttribute("tabindex", "-1");
                    this.currentFocused = e.target;
                }
            };
            /**
             * Handle blur events
             *
             * @internal
             */
            this.handleBlur = (e) => {
                if (e.target instanceof HTMLElement &&
                    (e.relatedTarget === null || !this.contains(e.relatedTarget))) {
                    this.setAttribute("tabindex", "0");
                }
            };
            /**
             * KeyDown handler
             *
             *  @internal
             */
            this.handleKeyDown = (e) => {
                if (e.defaultPrevented) {
                    return;
                }
                if (this.slottedTreeItems.length < 1) {
                    return true;
                }
                const treeItems = this.getVisibleNodes();
                switch (e.key) {
                    case keyHome:
                        if (treeItems.length) {
                            TreeItem$1.focusItem(treeItems[0]);
                        }
                        return;
                    case keyEnd:
                        if (treeItems.length) {
                            TreeItem$1.focusItem(treeItems[treeItems.length - 1]);
                        }
                        return;
                    case keyArrowLeft:
                        if (e.target && this.isFocusableElement(e.target)) {
                            const item = e.target;
                            if (item instanceof TreeItem$1 && item.childItemLength() > 0) {
                                item.expanded = false;
                            }
                        }
                        return false;
                    case keyArrowRight:
                        if (e.target && this.isFocusableElement(e.target)) {
                            const item = e.target;
                            if (item instanceof TreeItem$1 && item.childItemLength() > 0) {
                                item.expanded = true;
                            }
                        }
                        return;
                    case keyArrowDown:
                        if (e.target && this.isFocusableElement(e.target)) {
                            this.focusNextNode(1, e.target);
                        }
                        return;
                    case keyArrowUp:
                        if (e.target && this.isFocusableElement(e.target)) {
                            this.focusNextNode(-1, e.target);
                        }
                        return;
                    case keyEnter:
                        // In single-select trees where selection does not follow focus (see note below),
                        // the default action is typically to select the focused node.
                        this.handleClick(e);
                        return;
                }
                // don't prevent default if we took no action
                return true;
            };
            /**
             * Handles the selected-changed events bubbling up
             * from child tree items
             *
             *  @internal
             */
            this.handleSelectedChange = (e) => {
                if (e.defaultPrevented) {
                    return;
                }
                if (!(e.target instanceof Element) || !isTreeItemElement(e.target)) {
                    return true;
                }
                const item = e.target;
                if (item.selected) {
                    if (this.currentSelected && this.currentSelected !== item) {
                        this.currentSelected.selected = false;
                    }
                    // new selected item
                    this.currentSelected = item;
                }
                else if (!item.selected && this.currentSelected === item) {
                    // selected item deselected
                    this.currentSelected = null;
                }
                return;
            };
            /**
             * Updates the tree view when slottedTreeItems changes
             */
            this.setItems = () => {
                // force single selection
                // defaults to first one found
                const selectedItem = this.treeView.querySelector("[aria-selected='true']");
                this.currentSelected = selectedItem;
                // invalidate the current focused item if it is no longer valid
                if (this.currentFocused === null || !this.contains(this.currentFocused)) {
                    this.currentFocused = this.getValidFocusableItem();
                }
                // toggle properties on child elements
                this.nested = this.checkForNestedItems();
                const treeItems = this.getVisibleNodes();
                treeItems.forEach(node => {
                    if (isTreeItemElement(node)) {
                        node.nested = this.nested;
                    }
                });
            };
            /**
             * check if the item is focusable
             */
            this.isFocusableElement = (el) => {
                return isTreeItemElement(el);
            };
            this.isSelectedElement = (el) => {
                return el.selected;
            };
        }
        slottedTreeItemsChanged() {
            if (this.$fastController.isConnected) {
                // update for slotted children change
                this.setItems();
            }
        }
        connectedCallback() {
            super.connectedCallback();
            this.setAttribute("tabindex", "0");
            DOM.queueUpdate(() => {
                this.setItems();
            });
        }
        /**
         * Handles click events bubbling up
         *
         *  @internal
         */
        handleClick(e) {
            if (e.defaultPrevented) {
                // handled, do nothing
                return;
            }
            if (!(e.target instanceof Element) || !isTreeItemElement(e.target)) {
                // not a tree item, ignore
                return true;
            }
            const item = e.target;
            if (!item.disabled) {
                item.selected = !item.selected;
            }
            return;
        }
        /**
         * Move focus to a tree item based on its offset from the provided item
         */
        focusNextNode(delta, item) {
            const visibleNodes = this.getVisibleNodes();
            if (!visibleNodes) {
                return;
            }
            const focusItem = visibleNodes[visibleNodes.indexOf(item) + delta];
            if (isHTMLElement(focusItem)) {
                TreeItem$1.focusItem(focusItem);
            }
        }
        /**
         * checks if there are any nested tree items
         */
        getValidFocusableItem() {
            const treeItems = this.getVisibleNodes();
            // default to selected element if there is one
            let focusIndex = treeItems.findIndex(this.isSelectedElement);
            if (focusIndex === -1) {
                // otherwise first focusable tree item
                focusIndex = treeItems.findIndex(this.isFocusableElement);
            }
            if (focusIndex !== -1) {
                return treeItems[focusIndex];
            }
            return null;
        }
        /**
         * checks if there are any nested tree items
         */
        checkForNestedItems() {
            return this.slottedTreeItems.some((node) => {
                return isTreeItemElement(node) && node.querySelector("[role='treeitem']");
            });
        }
        getVisibleNodes() {
            return getDisplayedNodes(this, "[role='treeitem']") || [];
        }
    }
    __decorate$1([
        attr({ attribute: "render-collapsed-nodes" })
    ], TreeView$1.prototype, "renderCollapsedNodes", void 0);
    __decorate$1([
        observable
    ], TreeView$1.prototype, "currentSelected", void 0);
    __decorate$1([
        observable
    ], TreeView$1.prototype, "slottedTreeItems", void 0);

    /**
     * Do not edit directly
     * Generated on Tue, 01 Mar 2022 15:26:47 GMT
     */
    const Warning100DarkUi = "#ff8126";
    const Pass100LightUi = "#009921";
    const Pass100DarkUi = "#00c12b";
    const Fail100LightUi = "#c4000c";
    const Fail100DarkUi = "#ff4646";
    const Black75 = "#818386";
    const Black15 = "#f1f1f2";
    const Black7 = "#f5f5f5";
    const White = "#ffffff";
    const Black85 = "#363738";
    const Black80 = "#505153";
    const Black91 = "#161617";
    const ForestGreen = "#074023";
    const DigitalGreenLight = "#009b65";
    const Warning100LightUi = "#ff4b00";
    const Black30 = "#d3d5d6";
    const DigitalGreenDark = "#006b46";
    const PowerGreen = "#32eb96";
    const Title2Family = "Source Sans Pro";
    const Title2Weight = "400";
    const ControlLabel1Family = "Source Sans Pro";
    const ControlLabel1Weight = "600";
    const BodyFamily = "Source Sans Pro";
    const BodyWeight = "400";
    const GroupLabel1Family = "Space Mono";
    const GroupLabel1Weight = "400";
    const ButtonLabel1Family = "Source Sans Pro";
    const ButtonLabel1Weight = "400";
    const Title1Family = "Source Sans Pro";
    const Title1Weight = "400";
    const Headline2Family = "Noto Serif";
    const Headline2Weight = "400";
    const PlaceholderFamily = "Source Sans Pro";
    const PlaceholderWeight = "400";
    const TooltipCaptionFamily = "Source Sans Pro";
    const TooltipCaptionWeight = "400";
    const BodyEmphasizedFamily = "Source Sans Pro";
    const BodyEmphasizedWeight = "600";
    const Subtitle1Family = "Source Sans Pro";
    const Subtitle1Weight = "300";
    const Title3Family = "Source Sans Pro";
    const Title3Weight = "400";
    const Subtitle2Family = "Source Sans Pro";
    const Subtitle2Weight = "300";
    const LinkLightUiFamily = "Source Sans Pro";
    const LinkLightUiWeight = "400";
    const Headline1Family = "Noto Serif";
    const Headline1Weight = "400";
    const ErrorLightUiFamily = "Source Sans Pro";
    const ErrorLightUiWeight = "400";
    const Title2Size = "22px";
    const ControlLabel1Size = "11px";
    const BodySize = "14px";
    const GroupLabel1Size = "11px";
    const ButtonLabel1Size = "12.800000190734863px";
    const Title1Size = "19px";
    const Headline2Size = "29.100000381469727px";
    const PlaceholderSize = "14px";
    const TooltipCaptionSize = "11px";
    const BodyEmphasizedSize = "14px";
    const Subtitle1Size = "12.800000190734863px";
    const Title3Size = "25px";
    const Subtitle2Size = "16px";
    const LinkLightUiSize = "14px";
    const Headline1Size = "25px";
    const ErrorLightUiSize = "9px";
    const BodyLineHeight = "18px";
    const ControlLabel1LineHeight = "16px";
    const GroupLabel1LineHeight = "16px";
    const Headline2LineHeight = "40px";
    const Headline1LineHeight = "32px";
    const Title3LineHeight = "32px";
    const Title2LineHeight = "28px";
    const Title1LineHeight = "24px";
    const Subtitle2LineHeight = "20px";
    const Subtitle1LineHeight = "16px";
    const LinkLineHeight = "18px";
    const PlaceholderLineHeight = "18px";
    const BodyEmphasizedLineHeight = "18px";
    const ButtonLabel1LineHeight = "16px";
    const TooltipCaptionLineHeight = "14px";
    const SmallDelay = "0.1s"; // Short animation delay used for control state change animation
    const MediumDelay = "0.15s"; // Medium animation delay for control state change animation

    const hexCharacters = 'a-f\\d';
    const match3or4Hex = `#?[${hexCharacters}]{3}[${hexCharacters}]?`;
    const match6or8Hex = `#?[${hexCharacters}]{6}([${hexCharacters}]{2})?`;
    const nonHexChars = new RegExp(`[^#${hexCharacters}]`, 'gi');
    const validHexSize = new RegExp(`^${match3or4Hex}$|^${match6or8Hex}$`, 'i');

    function hexRgb(hex, options = {}) {
    	if (typeof hex !== 'string' || nonHexChars.test(hex) || !validHexSize.test(hex)) {
    		throw new TypeError('Expected a valid hex string');
    	}

    	hex = hex.replace(/^#/, '');
    	let alphaFromHex = 1;

    	if (hex.length === 8) {
    		alphaFromHex = Number.parseInt(hex.slice(6, 8), 16) / 255;
    		hex = hex.slice(0, 6);
    	}

    	if (hex.length === 4) {
    		alphaFromHex = Number.parseInt(hex.slice(3, 4).repeat(2), 16) / 255;
    		hex = hex.slice(0, 3);
    	}

    	if (hex.length === 3) {
    		hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    	}

    	const number = Number.parseInt(hex, 16);
    	const red = number >> 16;
    	const green = (number >> 8) & 255;
    	const blue = number & 255;
    	const alpha = typeof options.alpha === 'number' ? options.alpha : alphaFromHex;

    	if (options.format === 'array') {
    		return [red, green, blue, alpha];
    	}

    	if (options.format === 'css') {
    		const alphaString = alpha === 1 ? '' : ` / ${Number((alpha * 100).toFixed(2))}%`;
    		return `rgb(${red} ${green} ${blue}${alphaString})`;
    	}

    	return {red, green, blue, alpha};
    }

    var Theme;
    (function (Theme) {
        Theme["Light"] = "light";
        Theme["Dark"] = "dark";
        Theme["Color"] = "color";
    })(Theme || (Theme = {}));

    /**
     * Design token names should follow the token naming convention:
     * See: https://github.com/ni/nimble/blob/main/packages/nimble-components/CONTRIBUTING.md#token-naming
     */
    const tokenNames = {
        actionRgbPartialColor: 'action-rgb-partial-color',
        applicationBackgroundColor: 'application-background-color',
        headerBackgroundColor: 'header-background-color',
        sectionBackgroundColor: 'section-background-color',
        fillSelectedColor: 'fill-selected-color',
        fillSelectedRgbPartialColor: 'fill-selected-rgb-partial-color',
        fillHoverSelectedColor: 'fill-hover-selected-color',
        fillHoverColor: 'fill-hover-color',
        borderColor: 'border-color',
        borderRgbPartialColor: 'border-rgb-partial-color',
        failColor: 'fail-color',
        warningColor: 'warning-color',
        passColor: 'pass-color',
        borderHoverColor: 'border-hover-color',
        iconColor: 'icon-color',
        popupBoxShadowColor: 'popup-box-shadow-color',
        popupBorderColor: 'popup-border-color',
        controlHeight: 'control-height',
        smallPadding: 'small-padding',
        standardPadding: 'standard-padding',
        labelHeight: 'label-height',
        borderWidth: 'border-width',
        iconSize: 'icon-size',
        groupHeaderTextTransform: 'group-header-text-transform',
        drawerWidth: 'drawer-width',
        smallDelay: 'small-delay',
        mediumDelay: 'medium-delay',
        largeDelay: 'large-delay',
        headlinePlus1Font: 'headline-plus-1-font',
        headlinePlus1FontColor: 'headline-plus-1-font-color',
        headlinePlus1DisabledFontColor: 'headline-plus-1-disabled-font-color',
        headlinePlus1FontFamily: 'headline-plus-1-font-family',
        headlinePlus1FontSize: 'headline-plus-1-font-size',
        headlinePlus1FontWeight: 'headline-plus-1-font-weight',
        headlinePlus1FontLineHeight: 'headline-plus-1-font-line-height',
        headlinePlus1FallbackFontFamily: 'headline-plus-1-fallback-font-family',
        headlineFont: 'headline-font',
        headlineFontColor: 'headline-font-color',
        headlineDisabledFontColor: 'headline-disabled-font-color',
        headlineFontFamily: 'headline-font-family',
        headlineFontSize: 'headline-font-size',
        headlineFontWeight: 'headline-font-weight',
        headlineFontLineHeight: 'headline-font-line-height',
        headlineFallbackFontFamily: 'headline-fallback-font-family',
        titlePlus2Font: 'title-plus-2-font',
        titlePlus2FontColor: 'title-plus-2-font-color',
        titlePlus2DisabledFontColor: 'title-plus-2-disabled-font-color',
        titlePlus2FontFamily: 'title-plus-2-font-family',
        titlePlus2FontSize: 'title-plus-2-font-size',
        titlePlus2FontWeight: 'title-plus-2-font-weight',
        titlePlus2FontLineHeight: 'title-plus-2-font-line-height',
        titlePlus2FallbackFontFamily: 'title-plus-2-fallback-font-family',
        titlePlus1Font: 'title-plus-1-font',
        titlePlus1FontColor: 'title-plus-1-font-color',
        titlePlus1DisabledFontColor: 'title-plus-1-disabled-font-color',
        titlePlus1FontFamily: 'title-plus-1-font-family',
        titlePlus1FontSize: 'title-plus-1-font-size',
        titlePlus1FontWeight: 'title-plus-1-font-weight',
        titlePlus1FontLineHeight: 'title-plus-1-font-line-height',
        titlePlus1FallbackFontFamily: 'title-plus-1-fallback-font-family',
        titleFont: 'title-font',
        titleFontColor: 'title-font-color',
        titleDisabledFontColor: 'title-disabled-font-color',
        titleFontFamily: 'title-font-family',
        titleFontSize: 'title-font-size',
        titleFontWeight: 'title-font-weight',
        titleFontLineHeight: 'title-font-line-height',
        titleFallbackFontFamily: 'title-fallback-font-family',
        subtitlePlus1Font: 'subtitle-plus-1-font',
        subtitlePlus1FontColor: 'subtitle-plus-1-font-color',
        subtitlePlus1DisabledFontColor: 'subtitle-plus-1-disabled-font-color',
        subtitlePlus1FontFamily: 'subtitle-plus-1-font-family',
        subtitlePlus1FontSize: 'subtitle-plus-1-font-size',
        subtitlePlus1FontWeight: 'subtitle-plus-1-font-weight',
        subtitlePlus1FontLineHeight: 'subtitle-plus-1-font-line-height',
        subtitlePlus1FallbackFontFamily: 'subtitle-plus-1-fallback-font-family',
        subtitleFont: 'subtitle-font',
        subtitleFontColor: 'subtitle-font-color',
        subtitleDisabledFontColor: 'subtitle-disabled-font-color',
        subtitleFontFamily: 'subtitle-font-family',
        subtitleFontSize: 'subtitle-font-size',
        subtitleFontWeight: 'subtitle-font-weight',
        subtitleFontLineHeight: 'subtitle-font-line-height',
        subtitleFallbackFontFamily: 'subtitle-fallback-font-family',
        linkStandardFont: 'link-standard-font',
        linkStandardFontColor: 'link-standard-font-color',
        linkStandardDisabledFontColor: 'link-standard-disabled-font-color',
        linkStandardFontFamily: 'link-standard-font-family',
        linkStandardFontSize: 'link-standard-font-size',
        linkStandardFontWeight: 'link-standard-font-weight',
        linkStandardFontLineHeight: 'link-standard-font-line-height',
        linkStandardFallbackFontFamily: 'link-standard-fallback-font-family',
        placeholderFont: 'placeholder-font',
        placeholderFontColor: 'placeholder-font-color',
        placeholderDisabledFontColor: 'placeholder-disabled-font-color',
        placeholderFontFamily: 'placeholder-font-family',
        placeholderFontSize: 'placeholder-font-size',
        placeholderFontWeight: 'placeholder-font-weight',
        placeholderFontLineHeight: 'placeholder-font-line-height',
        placeholderFallbackFontFamily: 'placeholder-fallback-font-family',
        bodyEmphasizedFont: 'body-emphasized-font',
        bodyEmphasizedFontColor: 'body-emphasized-font-color',
        bodyEmphasizedDisabledFontColor: 'body-emphasized-disabled-font-color',
        bodyEmphasizedFontFamily: 'body-emphasized-font-family',
        bodyEmphasizedFontSize: 'body-emphasized-font-size',
        bodyEmphasizedFontWeight: 'body-emphasized-font-weight',
        bodyEmphasizedFontLineHeight: 'body-emphasized-font-line-height',
        bodyEmphasizedFallbackFontFamily: 'body-emphasized-fallback-font-family',
        bodyFont: 'body-font',
        bodyFontColor: 'body-font-color',
        bodyDisabledFontColor: 'body-disabled-font-color',
        bodyFontFamily: 'body-font-family',
        bodyFontSize: 'body-font-size',
        bodyFontWeight: 'body-font-weight',
        bodyFontLineHeight: 'body-font-line-height',
        bodyFallbackFontFamily: 'body-fallback-font-family',
        groupHeaderFont: 'group-header-font',
        groupHeaderFontColor: 'group-header-font-color',
        groupHeaderDisabledFontColor: 'group-header-disabled-font-color',
        groupHeaderFontFamily: 'group-header-font-family',
        groupHeaderFontSize: 'group-header-font-size',
        groupHeaderFontWeight: 'group-header-font-weight',
        groupHeaderFontLineHeight: 'group-header-font-line-height',
        groupHeaderFallbackFontFamily: 'group-header-fallback-font-family',
        controlLabelFont: 'control-label-font',
        controlLabelFontColor: 'control-label-font-color',
        controlLabelDisabledFontColor: 'control-label-disabled-font-color',
        controlLabelFontFamily: 'control-label-font-family',
        controlLabelFontSize: 'control-label-font-size',
        controlLabelFontWeight: 'control-label-font-weight',
        controlLabelFontLineHeight: 'control-label-font-line-height',
        controlLabelFallbackFontFamily: 'control-label-fallback-font-family',
        buttonLabelFont: 'button-label-font',
        buttonLabelFontColor: 'button-label-font-color',
        buttonLabelDisabledFontColor: 'button-label-disabled-font-color',
        buttonLabelFontFamily: 'button-label-font-family',
        buttonLabelFontSize: 'button-label-font-size',
        buttonLabelFontWeight: 'button-label-font-weight',
        buttonLabelFontLineHeight: 'button-label-font-line-height',
        buttonLabelFallbackFontFamily: 'button-label-fallback-font-family',
        tooltipCaptionFont: 'tooltip-caption-font',
        tooltipCaptionFontColor: 'tooltip-caption-font-color',
        tooltipCaptionDisabledFontColor: 'tooltip-caption-disabled-font-color',
        tooltipCaptionFontFamily: 'tooltip-caption-font-family',
        tooltipCaptionFontSize: 'tooltip-caption-font-size',
        tooltipCaptionFontWeight: 'tooltip-caption-font-weight',
        tooltipCaptionFontLineHeight: 'tooltip-caption-font-line-height',
        tooltipCaptionFallbackFontFamily: 'tooltip-caption-fallback-font-family',
        errorTextFont: 'error-text-font',
        errorTextFontColor: 'error-text-font-color',
        errorTextDisabledFontColor: 'error-text-disabled-font-color',
        errorTextFontFamily: 'error-text-font-family',
        errorTextFontSize: 'error-text-font-size',
        errorTextFontWeight: 'error-text-font-weight',
        errorTextFontLineHeight: 'error-text-font-line-height',
        errorTextFallbackFontFamily: 'error-text-fallback-font-family'
    };
    const prefix = 'ni-nimble';
    const styleNameFromTokenName = (tokenName) => `${prefix}-${tokenName}`;

    /*! *****************************************************************************
    Copyright (c) Microsoft Corporation.

    Permission to use, copy, modify, and/or distribute this software for any
    purpose with or without fee is hereby granted.

    THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
    REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
    AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
    INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
    LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
    OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
    PERFORMANCE OF THIS SOFTWARE.
    ***************************************************************************** */

    function __decorate(decorators, target, key, desc) {
        var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
        if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
        else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
        return c > 3 && r && Object.defineProperty(target, key, r), r;
    }

    const template$4 = html `<slot></slot>`;

    const styles$m = css `
    :host {
        display: contents;
    }
`;

    // Not represented as a CSS Custom Property, instead available
    // as an attribute of theme provider.
    const direction = DesignToken.create({
        name: 'direction',
        cssCustomPropertyName: null
    }).withDefault(Direction.ltr);
    const theme = DesignToken.create({
        name: 'theme',
        cssCustomPropertyName: null
    }).withDefault(Theme.Light);
    /**
     * The ThemeProvider implementation. Add this component to the page and set its `theme` attribute to control
     * the values of design tokens that provide colors and fonts as CSS custom properties to any descendant components.
     * @internal
     */
    class ThemeProvider extends FoundationElement {
        constructor() {
            super(...arguments);
            this.direction = Direction.ltr;
            this.theme = Theme.Light;
        }
        directionChanged(_prev, next) {
            if (next !== undefined && next !== null) {
                direction.setValueFor(this, next);
            }
            else {
                direction.deleteValueFor(this);
            }
        }
        themeChanged(_prev, next) {
            if (next !== undefined && next !== null) {
                theme.setValueFor(this, next);
            }
            else {
                theme.deleteValueFor(this);
            }
        }
    }
    __decorate([
        attr({
            attribute: 'direction'
        })
    ], ThemeProvider.prototype, "direction", void 0);
    __decorate([
        attr({
            attribute: 'theme'
        })
    ], ThemeProvider.prototype, "theme", void 0);
    const nimbleDesignSystemProvider = ThemeProvider.compose({
        baseName: 'theme-provider',
        styles: styles$m,
        template: template$4
    });
    DesignSystem.getOrCreate()
        .withPrefix('nimble')
        .register(nimbleDesignSystemProvider());

    /**
     * Convert a hexadecimal color string to an RGBA CSS color string
     * Example: 'ff0102' or '#ff0102' to 'rgba(255, 1, 2, 1)'
     * @param hexValue Hex color (with or without a starting '#')
     * @param alpha CSS alpha value between 0 (transparent) and 1 (opaque)
     * @returns An rgba()-formatted CSS color string
     */
    function hexToRgbaCssColor(hexValue, alpha) {
        const { red, green, blue } = hexRgb(hexValue);
        return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
    }

    // Color Tokens
    const actionRgbPartialColor = DesignToken.create(styleNameFromTokenName(tokenNames.actionRgbPartialColor)).withDefault((element) => hexToRgbPartial(getColorForTheme(element, Black91, Black15, White)));
    const applicationBackgroundColor = DesignToken.create(styleNameFromTokenName(tokenNames.applicationBackgroundColor)).withDefault((element) => getColorForTheme(element, White, Black85, ForestGreen));
    DesignToken.create(styleNameFromTokenName(tokenNames.headerBackgroundColor)).withDefault((element) => getColorForTheme(element, Black7, Black80, ForestGreen));
    DesignToken.create(styleNameFromTokenName(tokenNames.sectionBackgroundColor)).withDefault((element) => getColorForTheme(element, Black30, Black91, ForestGreen));
    const fillSelectedColor = DesignToken.create(styleNameFromTokenName(tokenNames.fillSelectedColor)).withDefault((element) => hexToRgbaCssColor(getFillSelectedColorForTheme(element), 0.3));
    const fillSelectedRgbPartialColor = DesignToken.create(styleNameFromTokenName(tokenNames.fillSelectedRgbPartialColor)).withDefault((element) => hexToRgbPartial(getFillSelectedColorForTheme(element)));
    const fillHoverSelectedColor = DesignToken.create(styleNameFromTokenName(tokenNames.fillHoverSelectedColor)).withDefault((element) => hexToRgbaCssColor(getFillSelectedColorForTheme(element), 0.15));
    const fillHoverColor = DesignToken.create(styleNameFromTokenName(tokenNames.fillHoverColor)).withDefault((element) => hexToRgbaCssColor(getFillHoverColorForTheme(element), 0.1));
    const borderColor = DesignToken.create(styleNameFromTokenName(tokenNames.borderColor)).withDefault((element) => getDefaultLineColorForTheme(element));
    const borderRgbPartialColor = DesignToken.create(styleNameFromTokenName(tokenNames.borderRgbPartialColor)).withDefault((element) => hexToRgbPartial(getDefaultLineColorForTheme(element)));
    const failColor = DesignToken.create(styleNameFromTokenName(tokenNames.failColor)).withDefault((element) => getFailColorForTheme(element));
    const warningColor = DesignToken.create(styleNameFromTokenName(tokenNames.warningColor)).withDefault((element) => getWarningColorForTheme(element));
    const passColor = DesignToken.create(styleNameFromTokenName(tokenNames.passColor)).withDefault((element) => getPassColorForTheme(element));
    const borderHoverColor = DesignToken.create(styleNameFromTokenName(tokenNames.borderHoverColor)).withDefault((element) => getColorForTheme(element, DigitalGreenLight, DigitalGreenLight, White));
    // Component Color Tokens
    const iconColor = DesignToken.create(styleNameFromTokenName(tokenNames.iconColor)).withDefault((element) => getColorForTheme(element, Black91, Black15, White));
    const popupBoxShadowColor = DesignToken.create(styleNameFromTokenName(tokenNames.popupBoxShadowColor)).withDefault((element) => hexToRgbaCssColor(getColorForTheme(element, Black75, Black85, Black85), 0.3));
    const popupBorderColor = DesignToken.create(styleNameFromTokenName(tokenNames.popupBorderColor)).withDefault((element) => hexToRgbaCssColor(getColorForTheme(element, Black91, Black15, White), 0.3));
    // Component Sizing Tokens
    const controlHeight = DesignToken.create(styleNameFromTokenName(tokenNames.controlHeight)).withDefault('32px');
    const smallPadding = DesignToken.create(styleNameFromTokenName(tokenNames.smallPadding)).withDefault('4px');
    const standardPadding = DesignToken.create(styleNameFromTokenName(tokenNames.standardPadding)).withDefault('16px');
    const labelHeight = DesignToken.create(styleNameFromTokenName(tokenNames.labelHeight)).withDefault('16px');
    const borderWidth = DesignToken.create(styleNameFromTokenName(tokenNames.borderWidth)).withDefault('1px');
    const iconSize = DesignToken.create(styleNameFromTokenName(tokenNames.iconSize)).withDefault('16px');
    const drawerWidth = DesignToken.create(styleNameFromTokenName(tokenNames.drawerWidth)).withDefault('784px');
    // Font Tokens
    createFontTokens(tokenNames.headlineFont, (element) => getDefaultFontColorForTheme(element), (element) => hexToRgbaCssColor(getDefaultFontColorForTheme(element), 0.3), Headline1Family, Headline1Weight, Headline1Size, Headline1LineHeight, 'serif');
    createFontTokens(tokenNames.headlinePlus1Font, (element) => getDefaultFontColorForTheme(element), (element) => hexToRgbaCssColor(getDefaultFontColorForTheme(element), 0.3), Headline2Family, Headline2Weight, Headline2Size, Headline2LineHeight, 'serif');
    createFontTokens(tokenNames.titlePlus2Font, (element) => getDefaultFontColorForTheme(element), (element) => hexToRgbaCssColor(getDefaultFontColorForTheme(element), 0.3), Title3Family, Title3Weight, Title3Size, Title3LineHeight, 'sans-serif');
    const [titlePlus1Font, titlePlus1FontColor, titlePlus1DisabledFontColor, titlePlus1FontFamily, titlePlus1FontWeight, titlePlus1FontSize, titlePlus1FontLineHeight, titlePlus1FallbackFontFamily] = createFontTokens(tokenNames.titlePlus1Font, (element) => getDefaultFontColorForTheme(element), (element) => hexToRgbaCssColor(getDefaultFontColorForTheme(element), 0.3), Title2Family, Title2Weight, Title2Size, Title2LineHeight, 'sans-serif');
    createFontTokens(tokenNames.titleFont, (element) => getDefaultFontColorForTheme(element), (element) => hexToRgbaCssColor(getDefaultFontColorForTheme(element), 0.3), Title1Family, Title1Weight, Title1Size, Title1LineHeight, 'sans-serif');
    createFontTokens(tokenNames.subtitlePlus1Font, (element) => getDefaultFontColorForTheme(element), (element) => hexToRgbaCssColor(getDefaultFontColorForTheme(element), 0.3), Subtitle2Family, Subtitle2Weight, Subtitle2Size, Subtitle2LineHeight, 'sans-serif');
    createFontTokens(tokenNames.subtitleFont, (element) => getDefaultFontColorForTheme(element), (element) => hexToRgbaCssColor(getDefaultFontColorForTheme(element), 0.3), Subtitle1Family, Subtitle1Weight, Subtitle1Size, Subtitle1LineHeight, 'sans-serif');
    createFontTokens(tokenNames.linkStandardFont, (element) => getDefaultFontColorForTheme(element), (element) => hexToRgbaCssColor(getDefaultFontColorForTheme(element), 0.3), LinkLightUiFamily, LinkLightUiWeight, LinkLightUiSize, LinkLineHeight, 'sans-serif');
    const [placeholderFont, placeholderFontColor, placeholderDisabledFontColor, placeholderFontFamily, placeholderFontWeight, placeholderFontSize, placeholderFontLineHeight, placeholderFallbackFontFamily] = createFontTokens(tokenNames.placeholderFont, (element) => hexToRgbaCssColor(getDefaultFontColorForTheme(element), 0.6), (element) => hexToRgbaCssColor(getDefaultFontColorForTheme(element), 0.3), PlaceholderFamily, PlaceholderWeight, PlaceholderSize, PlaceholderLineHeight, 'sans-serif');
    const [bodyEmphasizedFont, bodyEmphasizedFontColor, bodyEmphasizedDisabledFontColor, bodyEmphasizedFontFamily, bodyEmphasizedFontWeight, bodyEmphasizedFontSize, bodyEmphasizedFontLineHeight, bodyEmphasizedFallbackFontFamily] = createFontTokens(tokenNames.bodyEmphasizedFont, (element) => getDefaultFontColorForTheme(element), (element) => hexToRgbaCssColor(getDefaultFontColorForTheme(element), 0.3), BodyEmphasizedFamily, BodyEmphasizedWeight, BodyEmphasizedSize, BodyEmphasizedLineHeight, 'sans-serif');
    const [bodyFont, bodyFontColor, bodyDisabledFontColor, bodyFontFamily, bodyFontWeight, bodyFontSize, bodyFontLineHeight, bodyFallbackFontFamily] = createFontTokens(tokenNames.bodyFont, (element) => getDefaultFontColorForTheme(element), (element) => hexToRgbaCssColor(getDefaultFontColorForTheme(element), 0.3), BodyFamily, BodyWeight, BodySize, BodyLineHeight, 'sans-serif');
    const [groupHeaderFont, groupHeaderFontColor, groupHeaderDisabledFontColor, groupHeaderFontFamily, groupHeaderFontWeight, groupHeaderFontSize, groupHeaderFontLineHeight, groupHeaderFallbackFontFamily] = createFontTokens(tokenNames.groupHeaderFont, (element) => getDefaultFontColorForTheme(element), (element) => hexToRgbaCssColor(getDefaultFontColorForTheme(element), 0.3), GroupLabel1Family, GroupLabel1Weight, GroupLabel1Size, GroupLabel1LineHeight, 'sans-serif');
    const [controlLabelFont, controlLabelFontColor, controlLabelDisabledFontColor, controlLabelFontFamily, controlLabelFontWeight, controlLabelFontSize, controlLabelFontLineHeight, controlLabelFallbackFontFamily] = createFontTokens(tokenNames.controlLabelFont, (element) => hexToRgbaCssColor(getDefaultFontColorForTheme(element), 0.6), (element) => hexToRgbaCssColor(getDefaultFontColorForTheme(element), 0.3), ControlLabel1Family, ControlLabel1Weight, ControlLabel1Size, ControlLabel1LineHeight, 'sans-serif');
    const [buttonLabelFont, buttonLabelFontColor, buttonLabelDisabledFontColor, buttonLabelFontFamily, buttonLabelFontWeight, buttonLabelFontSize, buttonLabelFontLineHeight, buttonLabelFallbackFontFamily] = createFontTokens(tokenNames.buttonLabelFont, (element) => getDefaultFontColorForTheme(element), (element) => hexToRgbaCssColor(getDefaultFontColorForTheme(element), 0.3), ButtonLabel1Family, ButtonLabel1Weight, ButtonLabel1Size, ButtonLabel1LineHeight, 'sans-serif');
    createFontTokens(tokenNames.tooltipCaptionFont, (element) => getDefaultFontColorForTheme(element), (element) => hexToRgbaCssColor(getDefaultFontColorForTheme(element), 0.3), TooltipCaptionFamily, TooltipCaptionWeight, TooltipCaptionSize, TooltipCaptionLineHeight, 'sans-serif');
    const [errorTextFont, errorTextFontColor, errorTextDisabledFontColor, errorTextFontFamily, errorTextFontWeight, errorTextFontSize, errorTextFontLineHeight, errorTextFallbackFontFamily] = createFontTokens(tokenNames.errorTextFont, (element) => getFailColorForTheme(element), (element) => hexToRgbaCssColor(getFailColorForTheme(element), 0.3), ErrorLightUiFamily, ErrorLightUiWeight, ErrorLightUiSize, TooltipCaptionLineHeight, 'sans-serif');
    // Font Transform Tokens
    const groupHeaderTextTransform = DesignToken.create(styleNameFromTokenName(tokenNames.groupHeaderTextTransform)).withDefault('uppercase');
    // Animation Tokens
    const smallDelay = DesignToken.create(styleNameFromTokenName(tokenNames.smallDelay)).withDefault(SmallDelay);
    const mediumDelay = DesignToken.create(styleNameFromTokenName(tokenNames.mediumDelay)).withDefault(MediumDelay);
    const largeDelay = DesignToken.create(styleNameFromTokenName(tokenNames.largeDelay)).withDefault(250);
    // Private helpers functions
    function hexToRgbPartial(hexValue) {
        const { red, green, blue } = hexRgb(hexValue);
        return `${red}, ${green}, ${blue}`;
    }
    function createFontTokens(fontTokenName, colorFunction, disabledColorFunction, family, weight, size, lineHeight, fallbackFamily) {
        if (fontTokenName === ''
            || family === ''
            || weight === ''
            || size === ''
            || lineHeight === ''
            || fallbackFamily === '') {
            throw new Error('createFontTokens parameter unexpectedly set to empty string');
        }
        const fontToken = DesignToken.create(styleNameFromTokenName(fontTokenName)).withDefault(`${weight} ${size}/${lineHeight} ${family}, ${fallbackFamily}`);
        const fontNameParts = fontTokenName.split('-font');
        const tokenPrefixWithoutFont = fontNameParts[0];
        if (tokenPrefixWithoutFont === undefined || fontNameParts[1] !== '') {
            throw new Error(`fontTokenName value of ${fontTokenName} did not have the expected '-font' suffix`);
        }
        const fontColorToken = DesignToken.create(styleNameFromTokenName(`${tokenPrefixWithoutFont}-font-color`)).withDefault((element) => colorFunction(element));
        const fontDisabledColorToken = DesignToken.create(styleNameFromTokenName(`${tokenPrefixWithoutFont}-disabled-font-color`)).withDefault((element) => disabledColorFunction(element));
        const fontFamilyToken = DesignToken.create(styleNameFromTokenName(`${tokenPrefixWithoutFont}-font-family`)).withDefault(`${family}`);
        const fontWeightToken = DesignToken.create(styleNameFromTokenName(`${tokenPrefixWithoutFont}-font-weight`)).withDefault(`${weight}`);
        const fontSizeToken = DesignToken.create(styleNameFromTokenName(`${tokenPrefixWithoutFont}-font-size`)).withDefault(`${size}`);
        const fontLineHeightToken = DesignToken.create(styleNameFromTokenName(`${tokenPrefixWithoutFont}-font-line-height`)).withDefault(`${lineHeight}`);
        const fontFallbackFamilyToken = DesignToken.create(styleNameFromTokenName(`${tokenPrefixWithoutFont}-fallback-font-family`)).withDefault(`${fallbackFamily}`);
        return [
            fontToken,
            fontColorToken,
            fontDisabledColorToken,
            fontFamilyToken,
            fontWeightToken,
            fontSizeToken,
            fontLineHeightToken,
            fontFallbackFamilyToken
        ];
    }
    function getColorForTheme(element, lightThemeColor, darkThemeColor, colorThemeColor) {
        switch (theme.getValueFor(element)) {
            case Theme.Light:
                return lightThemeColor;
            case Theme.Dark:
                return darkThemeColor;
            case Theme.Color:
                return colorThemeColor;
            default:
                return lightThemeColor;
        }
    }
    function getWarningColorForTheme(element) {
        return getColorForTheme(element, Warning100LightUi, Warning100DarkUi, Warning100DarkUi);
    }
    function getFailColorForTheme(element) {
        return getColorForTheme(element, Fail100LightUi, Fail100DarkUi, Fail100DarkUi);
    }
    function getPassColorForTheme(element) {
        return getColorForTheme(element, Pass100LightUi, Pass100DarkUi, Pass100DarkUi);
    }
    function getDefaultLineColorForTheme(element) {
        return getColorForTheme(element, Black91, Black15, White);
    }
    function getDefaultFontColorForTheme(element) {
        return getColorForTheme(element, Black91, Black15, White);
    }
    function getFillSelectedColorForTheme(element) {
        return getColorForTheme(element, DigitalGreenLight, DigitalGreenLight, White);
    }
    function getFillHoverColorForTheme(element) {
        return getColorForTheme(element, Black91, Black15, White);
    }

    /* eslint-disable max-classes-per-file */
    /**
     * Subscription for {@link ThemeStyleSheetBehavior}
     */
    class ThemeStyleSheetBehaviorSubscription {
        constructor(themeStyles, source) {
            this.themeStyles = themeStyles;
            this.source = source;
            this.attached = null;
        }
        handleChange({ target, token }) {
            this.attach(token.getValueFor(target));
        }
        attach(theme) {
            if (this.attached !== this.themeStyles[theme]) {
                if (this.attached !== null) {
                    this.source.$fastController.removeStyles(this.attached);
                }
                this.attached = this.themeStyles[theme];
                if (this.attached !== null) {
                    this.source.$fastController.addStyles(this.attached);
                }
            }
        }
    }
    /**
     * Behavior to conditionally apply theme-based stylesheets.
     */
    class ThemeStyleSheetBehavior {
        constructor(lightStyle, darkStyleOrAlias, colorStyleOrAlias) {
            this.cache = new WeakMap();
            const light = lightStyle;
            const dark = ThemeStyleSheetBehavior.resolveTheme(darkStyleOrAlias, {
                light,
                dark: null,
                color: null
            });
            const color = ThemeStyleSheetBehavior.resolveTheme(colorStyleOrAlias, {
                light,
                dark,
                color: null
            });
            this.themeStyles = {
                light,
                dark,
                color
            };
        }
        static resolveTheme(value, currentThemeStyles) {
            if (value instanceof ElementStyles || value === null) {
                return value;
            }
            const currentStyle = currentThemeStyles[value];
            if (currentStyle === null) {
                throw new Error(`Tried to alias to theme '${value}' but the theme value is not set to a style.`);
            }
            return currentStyle;
        }
        /**
         * @internal
         */
        bind(source) {
            const subscriber = this.cache.get(source)
                || new ThemeStyleSheetBehaviorSubscription(this.themeStyles, source);
            const value = theme.getValueFor(source);
            // Currently subscriber from cache may have gone through unbind
            // but still be in cache so always resubscribe
            // See: https://github.com/microsoft/fast/issues/3246#issuecomment-1030424876
            theme.subscribe(subscriber, source);
            subscriber.attach(value);
            this.cache.set(source, subscriber);
        }
        /**
         * @internal
         */
        unbind(source) {
            const subscriber = this.cache.get(source);
            if (subscriber) {
                theme.unsubscribe(subscriber);
            }
            // Currently does not evict subscriber from cache
            // See: https://github.com/microsoft/fast/issues/3246#issuecomment-1030424876
        }
    }
    /**
     * Behavior to conditionally apply theme-based stylesheets. To determine which to apply,
     * the behavior will use the nearest ThemeProvider's 'theme' design system value.
     * To re-use the same style for multiple themes you can specify the name of an already
     * defined theme to alias them together.
     *
     * @public
     * @example
     * ```ts
     * css`
     *  // ...
     * `.withBehaviors(new ThemeStyleSheetBehavior(
     *   css`:host { ... Theme.Light style... }`),
     *   null, // No style needed for Theme.Dark style
     *   Theme.Light // For the Theme.Color style, re-use the previously set Theme.Light style
     * )
     * ```
     */
    const themeBehavior = (lightStyle, darkStyleOrAlias, colorStyleOrAlias) => new ThemeStyleSheetBehavior(lightStyle, darkStyleOrAlias, colorStyleOrAlias);

    const styles$l = css `
    ${display('inline-block')}

    :host {
        box-sizing: border-box;
        font: ${bodyFont};
        --ni-private-breadcrumb-link-font-color: ${bodyFontColor};
    }

    .list {
        display: flex;
        flex-wrap: wrap;
    }

    :host(.prominent-links) {
        --ni-private-breadcrumb-link-active-font-color: ${bodyFontColor};
    }

    ::slotted(*:first-child) {
        padding-left: 0px;
    }

    ::slotted(*:not([href]):last-child) {
        font: ${bodyEmphasizedFont};
    }
`.withBehaviors(themeBehavior(css `
            ${'' /* Light theme */}
            :host {
                --ni-private-breadcrumb-link-active-font-color: ${DigitalGreenDark};
            }

            :host(.prominent-links) {
                --ni-private-breadcrumb-link-font-color: ${DigitalGreenDark};
            }
        `, css `
            ${'' /* Dark theme */}
            :host {
                --ni-private-breadcrumb-link-active-font-color: ${PowerGreen};
            }

            :host(.prominent-links) {
                --ni-private-breadcrumb-link-font-color: ${PowerGreen};
            }
        `, css `
            ${'' /* Color theme */}
            :host {
                --ni-private-breadcrumb-link-active-font-color: ${hexToRgbaCssColor(White, 0.6)};
            }

            :host(.prominent-links) {
                --ni-private-breadcrumb-link-font-color: ${PowerGreen};
            }
        `));

    /**
     * A nimble-styled breadcrumb
     */
    class Breadcrumb extends Breadcrumb$1 {
    }
    const nimbleBreadcrumb = Breadcrumb.compose({
        baseName: 'breadcrumb',
        baseClass: Breadcrumb$1,
        template: breadcrumbTemplate,
        styles: styles$l
    });
    DesignSystem.getOrCreate().withPrefix('nimble').register(nimbleBreadcrumb());

    /* 🤖 this file was generated by svg-to-ts*/
    const add16X16 = {
        name: 'add_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M13 7H9V3H7v4H3v2h4v4h2V9h4V7z"/></svg>`
    };
    const arrowDownRightAndArrowUpLeft16X16 = {
        name: 'arrow_down_right_and_arrow_up_left_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M13.171 13.933l-2.276-2.247-.447 2.284-1.732-5.246 5.217 1.753-2.284.456 2.291 2.26zM2 2.746l2.29 2.261-2.283.456 5.217 1.753L5.492 1.97l-.447 2.284-2.276-2.247z"/></svg>`
    };
    const arrowExpanderDown16X16 = {
        name: 'arrow_expander_down_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M3.5 4.737l1.11-.732 3.357 5.472L11.397 4l1.103.743L7.955 12 3.5 4.737z"/></svg>`
    };
    const arrowExpanderLeft16X16 = {
        name: 'arrow_expander_left_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M11.263 3.5l.732 1.11-5.472 3.357L12 11.397l-.743 1.103L4 7.955 11.263 3.5z"/></svg>`
    };
    const arrowExpanderRight16X16 = {
        name: 'arrow_expander_right_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M4.737 12.5l-.732-1.11 5.472-3.357L4 4.603 4.743 3.5 12 8.045 4.737 12.5z"/></svg>`
    };
    const arrowExpanderUp16X16 = {
        name: 'arrow_expander_up_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M12.5 11.263l-1.11.732-3.357-5.472L4.603 12 3.5 11.257 8.045 4l4.455 7.263z"/></svg>`
    };
    const arrowLeftFromLine16X16 = {
        name: 'arrow_left_from_line_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M12 14h2V2h-2zM2 7.982L7.9 5 6.588 7.004 11 7v2H6.613L7.9 11z"/></svg>`
    };
    const arrowPartialRotateLeft16X16 = {
        name: 'arrow_partial_rotate_left_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M8 11.988a3.086 3.086 0 003.143-3.025 3.08 3.08 0 00-3.085-3.02v.088l.826 2.067-5.598-2.796L8.884 2.5l-.742 1.932a4.619 4.619 0 014.572 4.53A4.629 4.629 0 018 13.5z"/></svg>`
    };
    const arrowRightToLine16X16 = {
        name: 'arrow_right_to_line_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M12 14h2V2h-2zm-6.9-3l1.287-2H2V7l4.412.004L5.1 5 11 7.982z"/></svg>`
    };
    const arrowRotateRight16X16 = {
        name: 'arrow_rotate_right_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M8.9 2.773v1.715a3.366 3.366 0 013.3 3.428 3.366 3.366 0 01-3.3 3.429 3.36 3.36 0 01-3.293-3.366h.095l2.255.901-3.05-6.107L1.85 8.88l2.108-.808A5.039 5.039 0 008.9 13.059a5.05 5.05 0 004.95-5.143A5.05 5.05 0 008.9 2.773z"/></svg>`
    };
    const arrowURotateLeft16X16 = {
        name: 'arrow_u_rotate_left_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M8.857 9.453l-2.571-1.68v.908a3 3 0 003 3 3 3 0 003-3V3.11H14v5.571a4.714 4.714 0 01-4.714 4.715A4.714 4.714 0 014.57 8.68v-.908L2 9.453l3.403-6.849z"/></svg>`
    };
    const arrowUpLeftAndArrowDownRight16X16 = {
        name: 'arrow_up_left_and_arrow_down_right_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M4.195 4.977l-.451 2.296L2 2l5.256 1.762-2.301.458 6.849 6.803.452-2.296L14 14l-5.256-1.762 2.301-.458-6.85-6.803z"/></svg>`
    };
    const arrowsMaximize16X16 = {
        name: 'arrows_maximize_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M12.26 8.735L14 14l-5.25-1.763 2.295-.457-3.03-3.022L8 8.742l-.015.016.015.014-3.023 3.023 2.296.45L2 13.985l1.762-5.243.458 2.295 3.015-3.015.007-.007L7.258 8l-.016-.015L7.227 8l-3.03-3.03-.457 2.295L2 2l5.25 1.762-2.295.458 3.03 3.022.015.016.015-.016L8 7.227l3.023-3.022-2.296-.45L14 2.015l-1.762 5.243-.458-2.295L8.742 8l.016.015L8.773 8l3.03 3.03.457-2.295z"/></svg>`
    };
    const arrowsRepeat16X16 = {
        name: 'arrows_repeat_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M8.75 11.75L10 14l-6-3 6-3-1.25 2.25zM8 11h1a4 4 0 004-4M7.25 5.75L6 8l6-3-6-3 1.25 2.25zM8 5H7a4 4 0 00-4 4"/></svg>`
    };
    const bars16X16 = {
        name: 'bars_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M2 13v-2h12v2zm0-4V7h12v2zm0-4V3h12v2z"/></svg>`
    };
    const bell16X16 = {
        name: 'bell_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M8 14a2.05 2.05 0 01-2-2h4a2.05 2.05 0 01-2 2zm-5.25-3s0-.746.5-.746h.065c.935 0 1.435-4.918 1.435-4.918 0-.504.25-.504.25-.504h.067c.075-.037.183-.143.183-.463v-.484c.105-.842.953-1.331 2.25-1.43v-.262c0-.081.09-.15.219-.193h.562c.129.043.219.112.219.193v.263c1.297.098 2.145.587 2.25 1.43v.483c0 .32.108.426.183.463H11s.25 0 .25.483v.02s.5 4.92 1.5 4.92c.5 0 .5.745.5.745z"/></svg>`
    };
    const bellAndComment16X16 = {
        name: 'bell_and_comment_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M13.836 4.75H9.57a.71.71 0 00-.71.71v2.032a.71.71 0 00.71.711h.356L9.57 9.625l2.488-1.422h1.778a.71.71 0 00.71-.71V5.46a.71.71 0 00-.71-.711zM8.196 11H2.75s0-.746.5-.746h.065c.935 0 1.435-4.918 1.435-4.918 0-.504.25-.504.25-.504h.067c.075-.037.183-.143.183-.463v-.484c.105-.842.953-1.331 2.25-1.43v-.262c0-.081.09-.15.219-.193h.562c.129.043.219.112.219.193v.263c1.224.092 2.04.537 2.217 1.294H9.57a1.713 1.713 0 00-1.71 1.71v2.032a1.712 1.712 0 00.844 1.475zM6 12h4a2.05 2.05 0 01-2 2 2.05 2.05 0 01-2-2zm7.25-1H9.18l2.868-1.64c.198.527.431.894.702.894.5 0 .5.746.5.746z"/></svg>`
    };
    const bellCircle16X16 = {
        name: 'bell_circle_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M7.042 11h2a1 1 0 01-2 0zm4.5-1h-7s0-.497.333-.497h.043c.624 0 .957-3.28.957-3.28 0-.335.167-.335.167-.335h.044c.05-.025.122-.095.122-.309v-.322c.07-.561.636-.888 1.5-.953v-.175c0-.054.06-.1.146-.129h.375c.086.029.146.075.146.129v.175c.865.065 1.43.392 1.5.953v.322c0 .214.072.284.122.309h.045s.166 0 .166.322v.014s.334 3.279 1 3.279c.334 0 .334.497.334.497zm-3.5-7.5a5.5 5.5 0 11-5.5 5.5 5.506 5.506 0 015.5-5.5m0-1a6.5 6.5 0 106.5 6.5 6.5 6.5 0 00-6.5-6.5z"/></svg>`
    };
    const bellSolidCircle16X16 = {
        name: 'bell_solid_circle_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M1.5 8A6.5 6.5 0 008 14.5 6.5 6.5 0 0014.5 8 6.5 6.5 0 008 1.5 6.5 6.5 0 001.5 8zM8 12a1.025 1.025 0 01-1-1h2a1.025 1.025 0 01-1 1zm-3.5-2s0-.497.333-.497h.043c.624 0 .957-3.28.957-3.28 0-.335.167-.335.167-.335h.045c.05-.025.122-.095.122-.309v-.322c.07-.561.635-.888 1.5-.953v-.175c0-.054.06-.1.145-.129h.376c.085.029.145.075.145.129v.175c.865.065 1.43.392 1.5.953v.322c0 .214.073.284.122.309H10s.167 0 .167.322v.014s.333 3.279 1 3.279c.333 0 .333.497.333.497z"/></svg>`
    };
    const blockWithRibbon16X16 = {
        name: 'block_with_ribbon_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M2 2v10h4.762A4.496 4.496 0 0113 5.762V2zm12 7.5a3.5 3.5 0 10-6 2.442V14l2.5-1.667L13 14v-2.058A3.485 3.485 0 0014 9.5zM10.5 8A1.5 1.5 0 119 9.5 1.5 1.5 0 0110.5 8z"/></svg>`
    };
    const calendar16X16 = {
        name: 'calendar_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M4 4.023V2.977A.976.976 0 014.977 2h.046A.976.976 0 016 2.977v1.046A.977.977 0 015.023 5h-.046A.977.977 0 014 4.023zM13 4v.023A1.98 1.98 0 0111.023 6h-.046A1.98 1.98 0 019 4.023V4H7v.023A1.98 1.98 0 015.023 6h-.046A1.98 1.98 0 013 4.023V4a1 1 0 00-1 1v8a1 1 0 001 1h10a1 1 0 001-1V5a1 1 0 00-1-1zm-7 8H4v-1h2zm.001-1.999H4V9h2.001zm0-2.001H4V7h2.001zM9 12H7v-1h2zm0-1.999H7V9h2zM9 8H7V7h2zm3 4h-2v-1h2zm.001-1.999H10V9h2.001zm0-2.001H10V7h2.001zM10 4.023V2.977A.976.976 0 0110.977 2h.046a.976.976 0 01.977.977v1.046a.977.977 0 01-.977.977h-.046A.977.977 0 0110 4.023z"/></svg>`
    };
    const chartDiagram16X16 = {
        name: 'chart_diagram_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M11 10V7H8V5h1V2H6v3h1v2H4v3H3v3h3v-3H5V8h5v2H9v3h3v-3z"/></svg>`
    };
    const chartDiagramChildFocus16X16 = {
        name: 'chart_diagram_child_focus_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M12 10V7H8V5h1V2H6v3h1v2H3v3H2v3h3v-3H4V8h3v2H6v3h3v-3H8V8h3v2h-1v3h3v-3zm-8 2H3v-1h1zm4 0H7v-1h1zm4 0h-1v-1h1z"/></svg>`
    };
    const chartDiagramParentFocus16X16 = {
        name: 'chart_diagram_parent_focus_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M12 10V7H8V5h1V2H6v3h1v2H3v3H2v3h3v-3H4V8h3v2H6v3h3v-3H8V8h3v2h-1v3h3v-3zM7 4V3h1v1z"/></svg>`
    };
    const chartDiagramParentFocusTwoChild16X16 = {
        name: 'chart_diagram_parent_focus_two_child_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M11 10V7H8V5h1V2H6v3h1v2H4v3H3v3h3v-3H5V8h5v2H9v3h3v-3zm-6 2H4v-1h1zm6 0h-1v-1h1z"/></svg>`
    };
    const check16X16 = {
        name: 'check_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M13 5.287L6.182 12 3 8.867l1.363-1.343L6.24 9.37 11.693 4z"/></svg>`
    };
    const checkDot16X16 = {
        name: 'check_dot_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle class="cls-1" cx="12.5" cy="11.5" r="1.5"/><path class="cls-2" d="M14 4.693l-8.182 8.182L2 9.057 3.636 7.42l2.25 2.25 6.546-6.545z"/></svg>`
    };
    const circle16X16 = {
        name: 'circle_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M8 2a6 6 0 106 6 6 6 0 00-6-6zm0 9.429A3.429 3.429 0 1111.429 8 3.429 3.429 0 018 11.429z"/></svg>`
    };
    const circleBroken16X16 = {
        name: 'circle_broken_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M7 14A6.1 6.1 0 017 2v2.686a3.475 3.475 0 000 6.628zM9 2v2.686a3.475 3.475 0 010 6.628V14A6.1 6.1 0 009 2z"/></svg>`
    };
    const circleCheck16X16 = {
        name: 'circle_check_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M8 2a6 6 0 106 6 6 6 0 00-6-6zm-1.212 9.2L4 8.388 5.225 7.2l1.553 1.61 4.06-4.01L12 6.013z"/></svg>`
    };
    const circlePartialBroken16X16 = {
        name: 'circle_partial_broken_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M9 2v2.686a3.475 3.475 0 010 6.628V14A6.1 6.1 0 009 2z"/><path class="cls-2" d="M7 11.314a3.475 3.475 0 010-6.628V2a6.1 6.1 0 000 12z"/></svg>`
    };
    const circleSlash16X16 = {
        name: 'circle_slash_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M8 2a6 6 0 106 6 6 6 0 00-6-6zm.075 1.714a4.281 4.281 0 013.573 6.647L5.714 4.427a4.262 4.262 0 012.36-.713zM3.789 8a4.261 4.261 0 01.713-2.36l5.934 5.933A4.281 4.281 0 013.789 8z"/></svg>`
    };
    const circleX16X16 = {
        name: 'circle_x_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M8 2a6 6 0 106 6 6 6 0 00-6-6zm.075 1.714a4.263 4.263 0 012.409.743l-2.37 2.37-2.4-2.4a4.262 4.262 0 012.36-.713zM4.502 5.64l2.4 2.4-2.37 2.37a4.273 4.273 0 01-.03-4.77zm3.573 6.647a4.256 4.256 0 01-2.31-.685l2.349-2.35 2.322 2.322a4.261 4.261 0 01-2.361.713zm3.573-1.925L9.326 8.039l2.35-2.349a4.251 4.251 0 01-.028 4.67z"/></svg>`
    };
    const clipboard16X16 = {
        name: 'clipboard_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M11 5H5a2 2 0 012-2V2a1 1 0 012 0v1a2 2 0 012 2zm1-2v9H4V3H3a1 1 0 00-1 1v9a1 1 0 001 1h10a1 1 0 001-1V4a1 1 0 00-1-1zm-2 4H5v1h5zM8 9H5v1h3z"/></svg>`
    };
    const clock16X16 = {
        name: 'clock_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M8 2a6 6 0 106 6 6 6 0 00-6-6m.576 4.87l1.555-1.557a1.635 1.635 0 01.84-.256 1.979 1.979 0 01-.23.791c-.115.163-1.356 1.41-1.571 1.626a1.278 1.278 0 010 1.085l2.376 2.38a1.597 1.597 0 01.458 1.072 1.621 1.621 0 01-1.222-.613c-.456-.456-1.94-1.963-2.207-2.235a1.275 1.275 0 110-2.293"/></svg>`
    };
    const clockCog16X16 = {
        name: 'clock_cog_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M8.108 7.392l.955-.957a1.004 1.004 0 01.516-.157 1.215 1.215 0 01-.14.486c-.072.1-.834.866-.966.999a.785.785 0 010 .666l1.341 1.344a.981.981 0 01.281.658.996.996 0 01-.75-.376c-.28-.28-1.073-1.088-1.237-1.255a.783.783 0 110-1.408m5.69 2.292L14 7.324l-1.327-.113a4.76 4.76 0 00-.402-1.26l1.02-.86-1.527-1.811-1.019.86a4.726 4.726 0 00-.563-.344 4.61 4.61 0 00-.612-.265l.114-1.329L7.324 2l-.113 1.329a4.77 4.77 0 00-1.26.401l-.86-1.02L3.28 4.237l.858 1.02A4.771 4.771 0 003.53 6.43l-1.329-.114L2 8.676l1.329.114a4.69 4.69 0 00.401 1.26l-1.02.86 1.526 1.811 1.02-.859a4.666 4.666 0 001.175.608l-.113 1.33 2.358.2.114-1.328a4.688 4.688 0 001.26-.4l.86 1.02 1.81-1.527-.858-1.02a4.687 4.687 0 00.608-1.175zM8 11.45A3.45 3.45 0 1111.45 8 3.45 3.45 0 018 11.45z"/></svg>`
    };
    const clockTriangle16X16 = {
        name: 'clock_triangle_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M8 3a4.951 4.951 0 00-2.152.505L7.096 6H3.422A4.997 4.997 0 108 3zm2.003 7.616a453.75 453.75 0 01-1.675-1.7 1.061 1.061 0 110-1.907l1.294-1.297a1.36 1.36 0 01.699-.212 1.646 1.646 0 01-.19.658c-.097.136-1.13 1.173-1.309 1.353a1.063 1.063 0 010 .903l1.817 1.82a1.33 1.33 0 01.381.891 1.35 1.35 0 01-1.017-.51z"/><path class="cls-2" d="M5.477 5H1.522L3.5 1.045 5.477 5z"/></svg>`
    };
    const clone16X16 = {
        name: 'clone_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M5 5h5V2H2v8h3zm1 1v8h8V6z"/></svg>`
    };
    const cloudUpload16X16 = {
        name: 'cloud_upload_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M8.476 7.298l-1.927 3.848 1.48-.568v3.407h.948v-3.407l1.42.568zM15 9.005a2.374 2.374 0 01-2.371 2.371h-.998l-.5-1h1.498a1.371 1.371 0 10-.516-2.64A3.77 3.77 0 104.797 5.99 2.238 2.238 0 002 8.148a2.223 2.223 0 002.057 2.22l1.758.009-.448.894a10.567 10.567 0 01-2.31-.121 3.224 3.224 0 01.993-6.225 4.77 4.77 0 019.236 1.68c0 .04 0 .081-.002.121A2.375 2.375 0 0115 9.006z"/></svg>`
    };
    const cloudWithArrow16X16 = {
        name: 'cloud_with_arrow_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M12.429 10.1l.001-.101A3.998 3.998 0 004.69 8.59a2.715 2.715 0 00-2.557 2.7 2.782 2.782 0 001.725 2.516 4.854 4.854 0 001.225.19h.004c.19.006 6.792 0 6.792 0a1.987 1.987 0 00.55-3.897zm-.55 3.06l-7.183-.008a1.867 1.867 0 01.156-3.728 1.891 1.891 0 01.464.06 3.16 3.16 0 116.13 1.462 1.149 1.149 0 11.433 2.213zM4.5 4.5a1 1 0 111-1 1 1 0 01-1 1zm5.138.681l.496-1.241H7v-.828h3.134l-.496-1.293L13 3.502z"/></svg>`
    };
    const cog16X16 = {
        name: 'cog_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M6.823 2l-2.217.914.516 1.25a4.743 4.743 0 00-.95.944L2.925 4.59l-.922 2.212 1.247.52a4.82 4.82 0 00-.002 1.34L2 9.176l.914 2.218 1.248-.515a4.824 4.824 0 00.945.949l-.518 1.247 2.214.921.519-1.246a4.68 4.68 0 00.674.048 4.74 4.74 0 00.666-.047L9.176 14l2.218-.914-.515-1.248a4.828 4.828 0 00.95-.945l1.245.518.922-2.214-1.247-.519a4.73 4.73 0 00.002-1.34L14 6.824l-.914-2.218-1.25.515a4.739 4.739 0 00-.944-.949l.518-1.246-2.212-.922-.52 1.247a4.714 4.714 0 00-.676-.049 4.808 4.808 0 00-.663.047zm1.175 9a2.999 2.999 0 112.77-1.847 2.984 2.984 0 01-2.77 1.846M8 6.801a1.2 1.2 0 10.46.093A1.198 1.198 0 008 6.8"/></svg>`
    };
    const cogDatabase16X16 = {
        name: 'cog_database_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M13.147 11.648c-.01.006-.02.014-.032.02a4.1 4.1 0 01-.46.224l-.012.005c-.033.015-.068.028-.103.042-.051.019-.11.036-.162.055-.094.034-.186.068-.285.099-.034.01-.064.024-.1.033-.019.007-.042.012-.062.019q-.279.078-.58.144l-.133.03q-.324.068-.668.12l-.135.02c-.214.03-.431.057-.653.079l-.103.012a17.446 17.446 0 01-.903.06c-.254.01-.507.018-.759.018a18.75 18.75 0 01-1.66-.078l-.105-.012a15.901 15.901 0 01-.65-.08l-.134-.018c-.23-.036-.455-.076-.67-.122l-.132-.029a9.372 9.372 0 01-.582-.145l-.059-.017c-.036-.01-.067-.023-.1-.034a7.034 7.034 0 01-.285-.1c-.054-.018-.112-.035-.165-.055l-.101-.041-.01-.005a4.076 4.076 0 01-.462-.223l-.03-.02a2.343 2.343 0 01-.334-.24c-.014-.012-.033-.022-.045-.033v1.013c0 .364.524.749 1.427 1.051a8.098 8.098 0 00.697.197 14.793 14.793 0 003.4.363 14.818 14.818 0 003.403-.362 8.38 8.38 0 00.697-.197c.904-.303 1.43-.688 1.43-1.052v-1.013c-.015.012-.034.022-.047.034a2.478 2.478 0 01-.333.238m.38-1.883c0-.762-2.27-1.61-5.529-1.61-3.256 0-5.524.848-5.524 1.61 0 .365.525.75 1.427 1.052a9.254 9.254 0 00.698.197 14.8 14.8 0 003.399.362 14.817 14.817 0 003.401-.362 8.375 8.375 0 00.7-.197c.902-.302 1.428-.687 1.428-1.052M3.931 7.697L2.802 7.6l.171-1.979 1.129.095a3.984 3.984 0 01.516-.985l-.729-.856 1.537-1.28.73.855a4.085 4.085 0 011.071-.336L7.323 2l2.004.17-.097 1.114a3.949 3.949 0 01.52.223 4.027 4.027 0 01.478.288l.866-.721 1.296 1.52-.866.72a3.961 3.961 0 01.341 1.058l1.127.095-.133 1.539a10.211 10.211 0 00-2.482-.618c.007-.048.021-.094.026-.143a2.48 2.48 0 00-1.346-2.416 2.543 2.543 0 00-2.938.45 2.408 2.408 0 00-.698 2.14 11.88 11.88 0 00-1.482.311l-.008-.033zm4.067-.468c-.331 0-.697.012-1.077.035a.972.972 0 01-.026-.314.99.99 0 01.292-.618 1.011 1.011 0 011.174-.18.992.992 0 01.539.967.923.923 0 01-.036.132 17.817 17.817 0 00-.866-.022z"/></svg>`
    };
    const cogDatabaseInset16X16 = {
        name: 'cog_database_inset_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M12.751 7.338L14 6.824l-.914-2.218-1.25.515a4.74 4.74 0 00-.944-.949l.518-1.246-2.212-.922-.52 1.247a4.715 4.715 0 00-.676-.049 4.803 4.803 0 00-.663.047L6.823 2l-2.217.914.516 1.25a4.741 4.741 0 00-.95.944L2.925 4.59l-.922 2.212 1.247.52a4.816 4.816 0 00-.002 1.34L2 9.176l.914 2.218 1.248-.515a4.823 4.823 0 00.945.949l-.518 1.247 2.214.921.519-1.246a4.673 4.673 0 00.674.048 4.737 4.737 0 00.666-.047L9.176 14l2.218-.914-.515-1.248a4.826 4.826 0 00.95-.945l1.245.518.922-2.214-1.247-.519a4.729 4.729 0 00.002-1.34zm-1.06 2.418c0 .244-.35.5-.954.703a5.157 5.157 0 01-.466.131 9.896 9.896 0 01-2.273.243 9.88 9.88 0 01-2.271-.243 5.454 5.454 0 01-.466-.131c-.603-.202-.953-.46-.953-.703V9.08c.008.008.02.015.03.023a1.567 1.567 0 00.223.16l.02.013a2.725 2.725 0 00.309.15l.006.002.068.028c.035.013.074.025.11.037.062.023.125.046.19.066.023.008.043.016.067.023l.04.011c.123.036.253.069.389.098l.087.02c.144.03.295.057.448.08l.09.012c.142.021.286.038.434.054l.07.008c.162.014.327.027.491.035l.112.005a11.63 11.63 0 001.013 0l.11-.005c.165-.008.33-.02.493-.035l.069-.008c.148-.015.293-.033.436-.054l.09-.012q.23-.035.447-.08l.088-.02c.135-.03.264-.062.388-.097l.042-.012.066-.023c.066-.02.128-.043.19-.066.036-.012.075-.024.109-.037l.069-.028.007-.003a2.744 2.744 0 00.308-.149l.022-.014a1.651 1.651 0 00.222-.159l.03-.023zm0-1.76c0 .243-.35.5-.954.703a5.157 5.157 0 01-.466.13 9.897 9.897 0 01-2.273.243 9.88 9.88 0 01-2.271-.242 5.44 5.44 0 01-.466-.132c-.603-.202-.953-.459-.953-.703V7.32c.008.008.02.014.03.022a1.566 1.566 0 00.223.16l.02.013a2.716 2.716 0 00.309.15l.006.003c.022.01.046.018.068.027l.11.038c.062.022.125.045.19.066.023.007.043.016.067.023l.04.011c.123.035.253.067.389.097l.087.02c.144.03.295.057.448.08l.09.013c.142.02.286.038.434.053l.07.008a11.715 11.715 0 001.726.035c.165-.008.33-.02.493-.035l.069-.008c.148-.015.293-.033.436-.053l.09-.012q.23-.036.447-.081l.088-.02q.202-.044.388-.097c.014-.004.029-.007.042-.012.023-.006.043-.015.067-.022.065-.02.127-.044.19-.066l.108-.037.069-.028.008-.003a2.735 2.735 0 00.307-.15l.022-.013a1.657 1.657 0 00.222-.16c.009-.007.021-.014.03-.022zm-.953-1.05a5.625 5.625 0 01-.467.132 9.896 9.896 0 01-2.272.24 9.885 9.885 0 01-2.271-.24 6.179 6.179 0 01-.466-.133c-.603-.201-.954-.459-.954-.702 0-.51 1.515-1.076 3.69-1.076 2.177 0 3.694.567 3.694 1.076 0 .243-.351.5-.954.702z"/></svg>`
    };
    const cogSmallCog16X16 = {
        name: 'cog_small_cog_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M6.712 5.956a.76.76 0 01-.224.477.787.787 0 01-.909.139.762.762 0 01-.19-1.224.781.781 0 01.907-.14.767.767 0 01.416.748zM14 11.61l-.441 1.088-.62-.246a2.276 2.276 0 01-.232.268 2.386 2.386 0 01-.23.2l.263.606-1.09.46-.263-.606a2.353 2.353 0 01-.662.008l-.248.612-1.1-.435.249-.612a2.273 2.273 0 01-.256-.215 2.358 2.358 0 01-.218-.243l-.614.26-.466-1.077.614-.259a2.287 2.287 0 01-.008-.654l-.62-.246.44-1.087.62.246a2.38 2.38 0 01.234-.27 2.463 2.463 0 01.229-.198l-.263-.606 1.09-.46.263.605a2.422 2.422 0 01.662-.008l.248-.612 1.1.436-.248.612a2.351 2.351 0 01.473.458l.614-.26.466 1.076-.613.26a2.339 2.339 0 01.008.654zm-1.934-1.591a1.495 1.495 0 00-2.085.011 1.454 1.454 0 00.01 2.081 1.479 1.479 0 00.486.313 1.495 1.495 0 001.6-.324 1.454 1.454 0 00-.01-2.081zM9.036 8.33l-1.189.99-.564-.661a3.104 3.104 0 01-.827.26l-.075.86-1.547-.13.074-.862a3.075 3.075 0 01-.77-.394l-.671.557-1.001-1.174.67-.557a3.015 3.015 0 01-.264-.817L2 6.328 2.132 4.8l.872.074a3.08 3.08 0 01.4-.762l-.564-.66 1.188-.99.565.66a3.159 3.159 0 01.827-.26L5.494 2l1.548.131-.074.861a3.046 3.046 0 01.402.172 3.111 3.111 0 01.369.223l.669-.557L9.41 4.004l-.67.557a3.06 3.06 0 01.264.818l.871.073-.132 1.53-.872-.074a3.026 3.026 0 01-.4.762zM7.874 6.054a1.916 1.916 0 00-1.04-1.868 1.965 1.965 0 00-2.27.348 1.907 1.907 0 00.478 3.06 1.965 1.965 0 002.27-.347 1.903 1.903 0 00.562-1.193zm3.376 4.467a.6.6 0 00-.64.13.591.591 0 00-.131.196.584.584 0 00.33.761.597.597 0 00.64-.13.59.59 0 00.13-.195.583.583 0 00-.135-.637.596.596 0 00-.194-.125z"/></svg>`
    };
    const cogZoomed16X16 = {
        name: 'cog_zoomed_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M14 3.11l-1.178-.632-1.875 2.133a5.424 5.424 0 00-.716-.094L8.766 2l-2.138.627.2 2.863a5.226 5.226 0 00-.527.47l-2.77-.738-1.056 1.95L4.656 9.04a5.188 5.188 0 00-.087.704L2 11.144l.659 2.1 2.914-.197a4.961 4.961 0 00.453.525l-.13.427h7.232a.818.818 0 00.87-.759L14 13.2zm-1.335 7.876a2.877 2.877 0 01-3.741 1.477 2.768 2.768 0 01-1.51-3.66 2.876 2.876 0 013.729-1.482 2.76 2.76 0 011.535 3.637z"/></svg>`
    };
    const comment16X16 = {
        name: 'comment_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M14 3.5v6a1.5 1.5 0 01-1.5 1.5H8.75L3.5 14l.75-3H3.5A1.5 1.5 0 012 9.5v-6A1.5 1.5 0 013.5 2h9A1.5 1.5 0 0114 3.5z"/></svg>`
    };
    const computerAndMonitor16X16 = {
        name: 'computer_and_monitor_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M14 12V6H5v6h4v1H7v1h5v-1h-2v-1zm-8-1V7h7v4zm1-6H4V4h3zm1 0V3H3v7h1v3h2v1H3a1 1 0 01-1-1V3a1 1 0 011-1h5a1 1 0 011 1v2z"/></svg>`
    };
    const copy16X16 = {
        name: 'copy_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M5 5h5V2H2v8h3zm1 1v8h8V6zm7 7H7V7h6z"/></svg>`
    };
    const copyText16X16 = {
        name: 'copy_text_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M5 5h5V2H2v8h3zm1 1v8h8V6zm7 7H7V7h6zm-1-4H8V8h4zm-1 2H8v-1h3z"/></svg>`
    };
    const dashboardBuilder16X16 = {
        name: 'dashboard_builder_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M4.646 6.646L7 4.293l2 2 1.646-1.646.707.707L9 7.707l-2-2-1.646 1.647zM14 2v12H2V2zM8 9H4v3h4zm4 2H9v1h3zm0-2H9v1h3zm0-5H4v4h8V4zm-5 6H5v1h2z"/></svg>`
    };
    const dashboardBuilderLegend16X16 = {
        name: 'dashboard_builder_legend_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M2 2v12h12V2zm10 10H4v-1.293l2.04-2.04 3.804 2.983L12 9.74zm0-7h-2v1h2v2.405L9.805 10.35 5.96 7.333 4 9.293V6h2V5H4V4h8zM9 6H7V5h2z"/></svg>`
    };
    const dashboardBuilderTemplates16X16 = {
        name: 'dashboard_builder_templates_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M2 2v12h12V2zm11 11H3V3h10z"/><path class="cls-1" d="M9 9h3v1H9zM12 4H4v4h8zm-1 3H5V5h6zM8 9H4v3h4zm-1 2H5v-1h2zM9 11h3v1H9z"/></svg>`
    };
    const dashboardBuilderTile16X16 = {
        name: 'dashboard_builder_tile_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M4.646 10.646L7 8.293l2 2 1.646-1.646.707.707L9 11.707l-2-2-1.646 1.647zM14 2v12H2V2zM4 7h3V4H4zm8 1H4v4h8V8zm0-4H8v3h4z"/></svg>`
    };
    const database16X16 = {
        name: 'database_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M13.588 11.46a2.69 2.69 0 00.36-.257c.015-.012.036-.023.051-.036v1.093c0 .395-.57.81-1.551 1.137a9.133 9.133 0 01-.757.212A16.17 16.17 0 017.997 14a16.144 16.144 0 01-3.69-.391 8.83 8.83 0 01-.757-.213C2.57 13.069 2 12.655 2 12.26v-1.093c.013.013.033.023.049.036a2.61 2.61 0 00.362.26c.012.006.021.013.033.02a4.294 4.294 0 00.502.241l.01.005.11.046c.058.02.121.039.18.06.1.036.202.073.308.106.037.012.07.026.11.037.018.006.042.011.063.017.2.06.412.11.633.159l.142.031c.234.049.478.092.727.13.048.008.098.014.146.02a17.346 17.346 0 00.82.1 24.659 24.659 0 00.98.065c.273.01.55.019.822.019.273 0 .548-.008.824-.02.06-.003.119-.006.179-.007.268-.014.536-.034.801-.057l.112-.014c.24-.023.476-.052.708-.086.048-.006.098-.012.147-.02.25-.038.491-.081.725-.13.05-.012.096-.021.144-.031.219-.049.429-.1.63-.157.022-.008.047-.013.069-.02.037-.01.07-.024.108-.036.107-.034.206-.07.309-.107.057-.02.12-.038.176-.06.037-.014.075-.028.111-.045l.013-.005a4.316 4.316 0 00.5-.241.415.415 0 00.035-.022m0-2.845l-.035.022a4.46 4.46 0 01-.5.241l-.013.005c-.036.016-.074.03-.111.045l-.176.06c-.103.037-.202.073-.31.107-.037.012-.07.025-.107.036-.022.007-.047.012-.069.02a10.638 10.638 0 01-.774.187q-.35.075-.725.13c-.049.009-.099.014-.147.021-.232.034-.468.063-.708.086L9.8 9.59c-.265.024-.533.044-.801.057l-.18.008c-.275.012-.55.02-.823.02a19 19 0 01-.823-.02l-.18-.008a20.583 20.583 0 01-.8-.057l-.113-.013c-.241-.024-.475-.052-.706-.086-.048-.006-.098-.012-.146-.02a12.62 12.62 0 01-1.502-.32c-.021-.006-.045-.01-.063-.017-.04-.012-.073-.025-.11-.037a7.688 7.688 0 01-.309-.107c-.058-.02-.121-.039-.179-.06l-.11-.045-.01-.005a4.436 4.436 0 01-.502-.241c-.012-.007-.02-.014-.033-.02a2.544 2.544 0 01-.362-.26c-.016-.013-.036-.023-.049-.036v1.093c0 .394.57.81 1.55 1.136a8.83 8.83 0 00.757.213 16.145 16.145 0 003.69.39 16.171 16.171 0 003.694-.39 9.133 9.133 0 00.757-.213c.98-.327 1.551-.742 1.551-1.136V8.322c-.015.013-.036.024-.05.036a2.69 2.69 0 01-.361.258m0-2.845l-.035.022a4.463 4.463 0 01-.5.241l-.013.005c-.036.016-.074.03-.111.045l-.176.06c-.103.037-.202.073-.31.107-.037.012-.07.026-.107.036-.022.007-.047.012-.069.02q-.302.084-.63.156l-.144.031q-.351.075-.725.132c-.049.006-.099.012-.147.02-.232.032-.468.061-.708.085l-.112.013a19.05 19.05 0 01-.98.066c-.276.01-.55.018-.824.018a20.457 20.457 0 01-1.802-.084l-.114-.013c-.241-.024-.475-.053-.706-.086l-.146-.02c-.249-.038-.493-.081-.727-.13-.05-.01-.094-.022-.142-.032-.22-.048-.432-.1-.633-.157l-.063-.018c-.04-.011-.073-.025-.11-.037a7.688 7.688 0 01-.309-.107l-.179-.06-.11-.045-.01-.005a4.438 4.438 0 01-.502-.241c-.012-.007-.02-.014-.033-.02a2.544 2.544 0 01-.362-.26C2.033 5.5 2.013 5.488 2 5.476V6.57c0 .394.57.81 1.55 1.136a8.83 8.83 0 00.757.213 16.144 16.144 0 003.69.39 16.17 16.17 0 003.694-.39 9.133 9.133 0 00.757-.213c.98-.327 1.551-.742 1.551-1.136V5.477c-.015.013-.036.024-.05.036a2.69 2.69 0 01-.361.258M14 3.738C14 2.915 11.535 2 7.998 2 4.463 2 2 2.915 2 3.738c0 .394.57.81 1.55 1.135.113.039.23.074.355.11q.192.053.402.103a16.152 16.152 0 003.69.39 16.17 16.17 0 003.692-.39 9.13 9.13 0 00.759-.213C13.429 4.548 14 4.132 14 3.738"/></svg>`
    };
    const databaseCheck16X16 = {
        name: 'database_check_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M5.919 12.103a11.87 11.87 0 01-1.594-.26 7.445 7.445 0 01-.644-.182c-.835-.28-1.32-.635-1.32-.973v-.936c.011.01.029.02.042.031a2.226 2.226 0 00.308.222l.028.018a3.65 3.65 0 00.428.206l.009.005.093.038c.049.019.103.034.153.051.086.032.173.063.262.092.032.01.06.022.094.032l.054.014c.17.05.35.095.538.136l.121.027c.2.042.408.078.62.111.041.007.083.012.124.018.197.028.396.052.6.073l.038.005-.613.613zm-2.238-7.74a8.567 8.567 0 00.645.182 13.68 13.68 0 003.143.334 13.697 13.697 0 003.144-.334 7.753 7.753 0 00.646-.182c.835-.28 1.32-.635 1.32-.973 0-.704-2.098-1.488-5.11-1.488-3.01 0-5.107.784-5.107 1.488 0 .338.486.694 1.32.973zm5.047 6.495l.008.007.008-.008zm-5.047-4.07a7.471 7.471 0 00.644.182 13.675 13.675 0 003.143.335 13.697 13.697 0 003.146-.335 7.694 7.694 0 00.644-.181c.835-.28 1.321-.636 1.321-.973v-.937c-.013.012-.03.02-.043.032a2.29 2.29 0 01-.307.22.353.353 0 01-.03.02 3.788 3.788 0 01-.426.206l-.01.004c-.031.014-.064.026-.096.039-.047.017-.101.033-.15.05-.087.032-.172.064-.263.092-.032.01-.06.023-.092.032l-.058.016q-.257.073-.537.134l-.122.027q-.3.063-.618.112l-.124.017c-.198.029-.399.053-.604.074l-.095.01a16.15 16.15 0 01-.835.057c-.235.01-.468.016-.701.016a17.43 17.43 0 01-1.535-.072l-.097-.011a14.698 14.698 0 01-.6-.074l-.125-.017c-.212-.033-.42-.07-.62-.112l-.12-.027a8.673 8.673 0 01-.54-.134c-.018-.006-.037-.01-.053-.016-.034-.01-.062-.022-.094-.032a6.551 6.551 0 01-.262-.091c-.05-.018-.104-.034-.153-.052l-.093-.038-.01-.004a3.768 3.768 0 01-.427-.207l-.028-.017a2.167 2.167 0 01-.308-.223c-.013-.011-.031-.02-.042-.03v.936c0 .337.485.692 1.32.972zm0 2.436a7.471 7.471 0 00.644.182 13.147 13.147 0 002.644.328l.318-.318.323.324a14.377 14.377 0 002.473-.222l1.753-1.753-.063.028-.01.004c-.031.014-.063.027-.096.04-.047.017-.101.033-.15.05-.087.032-.171.063-.263.091-.032.01-.06.022-.092.032-.018.006-.04.01-.058.017a9.015 9.015 0 01-.66.16q-.298.064-.617.112l-.124.017c-.198.029-.399.054-.604.074l-.095.011c-.225.02-.454.037-.682.049l-.153.007a16.115 16.115 0 01-1.402 0l-.154-.007a17.43 17.43 0 01-.68-.049l-.097-.011a14.689 14.689 0 01-.6-.074c-.042-.006-.084-.01-.125-.017a10.679 10.679 0 01-1.28-.274l-.053-.015c-.034-.01-.062-.021-.094-.032a6.551 6.551 0 01-.262-.09c-.05-.018-.104-.034-.153-.053-.03-.012-.063-.024-.093-.038l-.01-.004a3.77 3.77 0 01-.427-.207l-.028-.017a2.169 2.169 0 01-.308-.223c-.014-.01-.031-.02-.042-.03v.936c0 .337.485.693 1.32.972zm9.269-1.6L8.736 11.84l-1.449-1.45-1.053 1.055 2.458 2.458 5.268-5.268z"/></svg>`
    };
    const desktop16X16 = {
        name: 'desktop_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M13 3H2v8h5v1H5v1h6v-1H9v-1h5V3zm0 7H3V4h10z"/></svg>`
    };
    const donutChart16X16 = {
        name: 'donut_chart_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M10.872 10.956a4.123 4.123 0 01-6.997-2.962v-.007H2v.007a5.995 5.995 0 0010.301 4.182zM8.372 2v1.884a4.13 4.13 0 012.992 6.501l1.429 1.224A6.008 6.008 0 008.37 2zM2.048 7.236h1.897a4.117 4.117 0 013.675-3.352V2A6.012 6.012 0 002.05 7.236z"/></svg>`
    };
    const dotSolidDotStroke16X16 = {
        name: 'dot_solid_dot_stroke_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M7 8a3 3 0 11-3-3 3 3 0 013 3zm5-2a2 2 0 102 2 2.002 2.002 0 00-2-2m0-1a3 3 0 11-3 3 3 3 0 013-3z"/></svg>`
    };
    const download16X16 = {
        name: 'download_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M14 9v5H2V9h1v4h10V9zm-5.982 2L11 5.1 8.996 6.412 9 2H7v4.387L5 5.1z"/></svg>`
    };
    const electronicChipZoomed16X16 = {
        name: 'electronic_chip_zoomed_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M13 14H7.333V9.333a2 2 0 012-2H14V13a1 1 0 01-1 1zM12 2a.667.667 0 00-.667.667v2h1.334v-2A.667.667 0 0012 2zM8.444 2a.667.667 0 00-.666.667v2H9.11v-2A.667.667 0 008.444 2zM2 8.444a.667.667 0 00.667.667h2V7.778h-2A.667.667 0 002 8.444zM2 12a.667.667 0 00.667.667h2v-1.334h-2A.667.667 0 002 12zm11.556-8.222v.889a.444.444 0 01-.445.444H10.89a.444.444 0 01-.445-.444v-.89H10v.89a.444.444 0 01-.444.444H7.333a.444.444 0 01-.444-.444v-.89H4.667a.889.889 0 00-.89.89v2.222h.89a.444.444 0 01.444.444v2.223a.444.444 0 01-.444.444h-.89v.444h.89a.444.444 0 01.444.445v2.222a.444.444 0 01-.444.445h-.89V14H6.89V8.222A1.333 1.333 0 018.222 6.89H14V3.778z"/></svg>`
    };
    const exclamationMark16X16 = {
        name: 'exclamation_mark_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M6.371 11.873h3.256V14H6.37zM6.316 2l.37 8.542h2.628L9.684 2z"/></svg>`
    };
    const eye16X16 = {
        name: 'eye_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M7.856 3.657A7.004 7.004 0 001 8.001a7.588 7.588 0 007.146 4.342A7.002 7.002 0 0015 8a7.586 7.586 0 00-7.144-4.344m-1.199 7.289A5.108 5.108 0 012.443 8s.665-2.585 4.33-3.037a2.786 2.786 0 00-1.414 1.223l2.787 1.22H4.977a3.47 3.47 0 00-.053.576 3.348 3.348 0 001.734 2.962m2.85.02a3.4 3.4 0 00.107-5.908 5.006 5.006 0 013.942 2.944s-.603 2.44-4.05 2.963"/></svg>`
    };
    const fancyA16X16 = {
        name: 'fancy_a_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M10.597 9.844H7.865A7.465 7.465 0 016.19 11.96a3.323 3.323 0 01-2.042.667 2.835 2.835 0 01-1.964-.753L2 11.706l1.153-1.152.157.251a1.347 1.347 0 001.2.716 1.976 1.976 0 001.385-.625 11.546 11.546 0 001.722-2.403l2.252-3.88a7.585 7.585 0 00-.679-.037 2.365 2.365 0 00-1.66.54 1.967 1.967 0 00-.556 1.51V6.7l-.067.106-1.564.762.045-.423a3.845 3.845 0 01.645-1.874 3.312 3.312 0 011.34-1.177 6.74 6.74 0 012.208-.443c.127 0 .277-.013.471-.029l.369-.03 1.387-.257.087 2.154.33 3.886a4.862 4.862 0 00.29 1.701.498.498 0 00.528.31c.057 0 .277 0 .641-.03L14 11.33l-.172.83-3.003.506zm-.086-.896l-.275-3.22-1.855 3.22z"/></svg>`
    };
    const file16X16 = {
        name: 'file_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M4 3v10h8V7H8V3zm5 0v3h3z"/></svg>`
    };
    const fileDrawer16X16 = {
        name: 'file_drawer_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M2 4v10h12V4zm8 4H6V6h4zm4-5H2V2h12z"/></svg>`
    };
    const fileSearch16X16 = {
        name: 'file_search_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M14 6v6h-3.333a3.662 3.662 0 00.249-1.302A3.701 3.701 0 007.22 7 3.654 3.654 0 006 7.223V2h4v4zm-3-4v3h3zm-1.126 8.698a2.697 2.697 0 01-4.73 1.772L2.521 14l-.48-.823 2.613-1.523a2.698 2.698 0 115.22-.956zm-.952 0a1.745 1.745 0 10-1.745 1.745 1.747 1.747 0 001.745-1.745z"/></svg>`
    };
    const filter16X16 = {
        name: 'filter_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M2 3.045v1.29h.787a2.069 2.069 0 102.907 2.903l1.32 2.173v4.522l1.973-1.846V9.411l3.878-5.076h1.134v-1.29zm2.033 4.059a1.154 1.154 0 010-2.308c.023 0 .045.006.068.007l1.002 1.575a1.154 1.154 0 01-1.07.726z"/></svg>`
    };
    const floppyDiskCheckmark16X16 = {
        name: 'floppy_disk_checkmark_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M12.455 5h-1.041l-1.005 1H12v3H4V6h3.782L6.79 5H3.583A.585.585 0 003 5.598V12.5l1.5 1.497 7.858.003a.602.602 0 00.6-.6L13 5.545A.513.513 0 0012.455 5zM11 13H8v-2H6v2H5v-3h6zm2-10.99L9.091 5.9 7 3.79l.919-.89 1.164 1.208L12.128 1.1l.872.91"/></svg>`
    };
    const floppyDiskStarArrowRight16X16 = {
        name: 'floppy_disk_star_arrow_right_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M5.5 2.5a1 1 0 10-1 1 1 1 0 001-1zm7.5.002L9.638.819l.496 1.293H7v.828h3.134L9.638 4.18zM12.455 5H3.583A.585.585 0 003 5.598V12.5l1.5 1.497 7.858.003a.602.602 0 00.6-.6L13 5.545A.513.513 0 0012.455 5zM11 13H8v-2H6v2H5v-3h6zm1-4H4V6h8z"/></svg>`
    };
    const floppyDiskThreeDots16X16 = {
        name: 'floppy_disk_three_dots_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M6 3a1 1 0 10-1 1 1 1 0 001-1zm3 0a1 1 0 10-1 1 1 1 0 001-1zm3 0a1 1 0 10-1 1 1 1 0 001-1zm.455 2H3.583A.585.585 0 003 5.598V12.5l1.5 1.497 7.858.003a.602.602 0 00.6-.6L13 5.545A.513.513 0 0012.455 5zM11 13H8v-2H6v2H5v-3h6zm1-4H4V6h8z"/></svg>`
    };
    const folder16X16 = {
        name: 'folder_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M7 4V3H2v10h12V4zm6 2H3V5h10z"/></svg>`
    };
    const folderOpen16X16 = {
        name: 'folder_open_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M7 3v1.002h6V6h-1V5H3v1H2V3zM2 13h11l1-6H2z"/></svg>`
    };
    const forwardSlash16X16 = {
        name: 'forward_slash_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M6.027 14l2.5-12h1.5l-2.5 12h-1.5z"/></svg>`
    };
    const fourDotsSquare16X16 = {
        name: 'four_dots_square_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M6.5 11A1.5 1.5 0 115 9.5 1.5 1.5 0 016.5 11zM5 3.5A1.5 1.5 0 106.5 5 1.5 1.5 0 005 3.5zm7.5 7.5A1.5 1.5 0 1111 9.5a1.5 1.5 0 011.5 1.5zM11 3.5A1.5 1.5 0 1012.5 5 1.5 1.5 0 0011 3.5z"/></svg>`
    };
    const function16X16 = {
        name: 'function_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M14 12.643h-1.572l-.898-1.283-.923 1.283h-1.54l1.658-2.146-1.632-2.14h1.572l.883 1.258.888-1.258h1.545l-1.635 2.111zM9.544 4.667H9.31a3.141 3.141 0 00-.394-.1 2.455 2.455 0 00-.483-.05 1.32 1.32 0 00-.832.241 1.334 1.334 0 00-.405.895l-.128.937h1.846v1.282H6.812l-.376 2.462a3.578 3.578 0 01-.462 1.357 2.583 2.583 0 01-.784.808 3.015 3.015 0 01-.938.387A4.823 4.823 0 013.184 13q-.275 0-.629-.03A3.529 3.529 0 012 12.892v-1.815h.12a.56.56 0 00.424.244 2.538 2.538 0 00.5.052 1.304 1.304 0 00.898-.29 1.584 1.584 0 00.424-.985l.33-2.226H3.256V6.59H5.05l.178-1.162a2.942 2.942 0 01.444-1.244 2.516 2.516 0 01.76-.734 2.643 2.643 0 01.94-.356A5.61 5.61 0 018.357 3q.294 0 .588.025t.599.076z"/></svg>`
    };
    const gaugeSimple16X16 = {
        name: 'gauge_simple_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M10.969 5.196a1.763 1.763 0 011.142-.49 1.763 1.763 0 01-.49 1.142L9.205 8.263l.008.025.065.184.03.093a1.352 1.352 0 01.032.295 1.385 1.385 0 01-2.769 0 1.343 1.343 0 01.033-.294l.034-.11.055-.16.012-.033.014-.014a1.389 1.389 0 01.625-.625l.015-.015.033-.011.16-.055.11-.035a1.32 1.32 0 01.588 0l.11.035.16.055.033.011zM14 8.86a5.979 5.979 0 01-1.799 4.28l-1.309-1.308a4.085 4.085 0 00.83-4.78l.55-.55a2.576 2.576 0 00.64-1.082A5.968 5.968 0 0114 8.86zm-6-6a5.998 5.998 0 00-4.201 10.28l1.308-1.308a4.14 4.14 0 014.645-6.725l.564-.564a2.57 2.57 0 011.07-.635A5.97 5.97 0 008 2.86z"/></svg>`
    };
    const gridThreeByThree16X16 = {
        name: 'grid_three_by_three_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M2 3v10a1 1 0 001 1h10a1 1 0 001-1V3a1 1 0 00-1-1H3a1 1 0 00-1 1zm4 9H4v-2h2zm.001-2.999H4V7h2.001zm0-3.001H4V4h2.001zM9 12H7v-2h2zm0-2.999H7V7h2zM9 6H7V4h2zm3 6h-2v-2h2zm.001-2.999H10V7h2.001zm0-3.001H10V4h2.001z"/></svg>`
    };
    const gridTwoByTwo16X16 = {
        name: 'grid_two_by_two_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M4 9h3v3H4zm5 0h3v3H9zM4 4h3v3H4zm5 0h3v3H9zM2 14h12V2H2z"/></svg>`
    };
    const hammer16X16 = {
        name: 'hammer_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M9 14H6V8h3zM8.875 2H6.723A1.991 1.991 0 015 3a2.486 2.486 0 01-2-1H2v4h1a1.797 1.797 0 011.5-1C5.551 5 5.997 6.99 6 7h3c.333-1.539 1-2.436 1.741-2.436C12.222 4.564 14 6.615 14 6.615S13 2 8.875 2z"/></svg>`
    };
    const hashtag16X16 = {
        name: 'hashtag_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M7.76 14l.752-2.914H6.045L5.299 14H3.532l.746-2.914H2v-1.72h2.712l.701-2.807H2.947v-1.72h2.91L6.567 2h1.766l-.71 2.838h2.46L10.8 2h1.768l-.717 2.838H14v1.72h-2.599l-.706 2.807h2.374v1.72h-2.807L9.501 14zM6.447 9.392h2.506l.72-2.85H7.167z"/></svg>`
    };
    const home16X16 = {
        name: 'home_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M7.988 2L2.5 9H4v5h3v-3h2v3h3V9h1.5L7.988 2z"/></svg>`
    };
    const hourglass16X16 = {
        name: 'hourglass_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M10.774 13.4h-.047v-.49h-.404a2.491 2.491 0 00.355-1.258c0-1.826-2.083-2.886-2.083-3.652s2.083-1.826 2.083-3.652a2.491 2.491 0 00-.355-1.257h.404V2.6h.047a.556.556 0 00.499-.6H4.727a.556.556 0 00.499.6h.047v.49h.404a2.491 2.491 0 00-.355 1.258c0 1.826 2.083 2.87 2.083 3.652s-2.083 1.826-2.083 3.652a2.491 2.491 0 00.355 1.257h-.404v.491h-.047a.556.556 0 00-.499.6h6.546a.556.556 0 00-.499-.6zM8 12.957c-1.565 0-1.975-.585-1.975-1.305a7.183 7.183 0 011.723-.656c.268 0 .289-3.513 0-3.779l-.988-1h2.454l-.962 1c-.268.286-.275 3.779 0 3.779a7.651 7.651 0 011.738.656c0 .72-.409 1.305-1.99 1.305z"/></svg>`
    };
    const indeterminantCheckbox16X16 = {
        name: 'indeterminant_checkbox_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M12 3a1.001 1.001 0 011 1v8a1.001 1.001 0 01-1 1H4a1.001 1.001 0 01-1-1V4a1.001 1.001 0 011-1h8m0-1H4a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2V4a2 2 0 00-2-2zM4 4v8h8V4zm6 6H6V6h4z"/></svg>`
    };
    const info16X16 = {
        name: 'info_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M7.415 7.75v3.69H6.376v1.576h4.24V11.44H9.6V6.175H6.376V7.75zm.276-2.698a1.19 1.19 0 002.035-.838 1.164 1.164 0 00-.346-.846 1.193 1.193 0 00-1.693 0 1.158 1.158 0 00-.35.846 1.144 1.144 0 00.354.838z"/></svg>`
    };
    const infoCircle16X16 = {
        name: 'info_circle_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M8 2a6 6 0 106 6 6 6 0 00-6-6zm-.697 2.28a.951.951 0 011.35 0 .928.928 0 01.276.675.952.952 0 01-1.905 0 .924.924 0 01.279-.674zM9.7 12H6.3v-1.264h.833V7.777H6.3V6.513h2.584v4.223H9.7z"/></svg>`
    };
    const key16X16 = {
        name: 'key_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M12.045 7.348l-.652-.652 1.444-.14zm-3.818.698l-4.912 4.912-.395-.396 4.12-4.12zm4.734-2.918l-1.697.136-.395-.395L11 3.176l.72-.067 1.304 1.304zm-3.524-.386l-.651-.653.791-.791zm-1.955-.653v2.607l-5.074 5.075L2 12.946l.791.791 1.432.129.326-.326v-.652l.652-.652h.652l.326-.325v-.652h.651l.978-.978.014-.652.312-.326h.652l.652-.651h2.607l1.676-1.676L14 4.089l-1.955-1.955-2.887.28z"/></svg>`
    };
    const laptop16X16 = {
        name: 'laptop_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M13 11V3H3v8H2v2h12v-2zm-2 1H5v-1h6zm1-1.996H4V4h8z"/></svg>`
    };
    const layerGroup16X16 = {
        name: 'layer_group_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M3.555 9.546l.89-.445 5.333 2.667 1.778-.89.889.449v1.33L9.778 13.99l-6.223-3.11zm0-6.222L6.222 1.99l6.223 3.112v1.333L9.778 7.768l-6.223-3.11zm0 3.11l.89-.444 5.333 2.667 1.778-.89.889.448v1.33L9.778 10.88 3.555 7.768z"/></svg>`
    };
    const lightningBolt16X16 = {
        name: 'lightning_bolt_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M4.732 7.953L6.909 2h3.636L8.364 7.013h2.909L4.727 14l2.21-6.049z"/></svg>`
    };
    const link16X16 = {
        name: 'link_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M7.465 5.592A2.908 2.908 0 019.963 7.02l-1.06 1.065c-.053-.103-.095-.192-.144-.276a1.48 1.48 0 00-1.277-.769 1.43 1.43 0 00-.977.394c-.75.694-1.469 1.421-2.165 2.168a1.431 1.431 0 00.054 2.038 1.507 1.507 0 001.039.432 1.28 1.28 0 00.953-.417c.103-.11.435-.44.81-.805a3.458 3.458 0 001.908.188c-1.006 1.035-2.179 2.187-2.996 2.38a2.982 2.982 0 01-.693.082 2.91 2.91 0 01-2.182-4.842A46.793 46.793 0 015.53 6.356a2.826 2.826 0 011.935-.764M10.583 2.5a3.001 3.001 0 00-.69.081 10.376 10.376 0 00-2.996 2.377 3.474 3.474 0 01.568-.054 3.58 3.58 0 011.31.249c.38-.332.701-.646.875-.834a1.221 1.221 0 01.913-.395 1.513 1.513 0 011.074.469 1.433 1.433 0 01.022 2.005c-.7.743-1.42 1.47-2.165 2.167a1.419 1.419 0 01-.975.395 1.483 1.483 0 01-1.28-.768c-.048-.085-.089-.175-.151-.298L6.043 8.987a2.882 2.882 0 002.493 1.42 2.808 2.808 0 001.93-.76 54.2 54.2 0 002.266-2.266A2.911 2.911 0 0010.583 2.5"/></svg>`
    };
    const linkCancel16X16 = {
        name: 'link_cancel_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M9.202 9.45a2.638 2.638 0 01.687 2.519l-1.364.002c.032-.1.062-.183.085-.269a1.343 1.343 0 00-.326-1.312 1.297 1.297 0 00-.88-.374 37.657 37.657 0 00-2.779.002 1.298 1.298 0 00-1.273 1.341 1.367 1.367 0 00.39.944 1.162 1.162 0 00.878.344c.137-.005.562-.002 1.036.004a3.137 3.137 0 001.104 1.344 8.133 8.133 0 01-3.45-.395 2.705 2.705 0 01-.496-.392A2.64 2.64 0 014.52 8.702a42.45 42.45 0 012.951-.003 2.564 2.564 0 011.731.751m3.984.017a2.723 2.723 0 00-.495-.39 9.414 9.414 0 00-3.447-.398 3.151 3.151 0 01.4.33 3.247 3.247 0 01.68 1c.457.031.864.035 1.096.027a1.108 1.108 0 01.839.331 1.373 1.373 0 01.389.99 1.3 1.3 0 01-1.272 1.3c-.926.028-1.854.033-2.78.002a1.287 1.287 0 01-.878-.372 1.345 1.345 0 01-.328-1.313c.023-.086.054-.17.093-.289l-1.371.031a2.614 2.614 0 00.688 2.51 2.547 2.547 0 001.726.751c.968.033 1.94.025 2.908 0a2.641 2.641 0 001.752-4.51m-2.701-3.208L8.71 4.485l1.775-1.775-.71-.71L8 3.775 6.225 2l-.71.71L7.29 4.485 5.515 6.259l.71.71L8 5.195l1.775 1.774z"/></svg>`
    };
    const list16X16 = {
        name: 'list_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M4 13H2v-2h2zm10-2H6v2h8zM4 7H2v2h2zm10 0H6v2h8zM4 3H2v2h2zm10 0H6v2h8z"/></svg>`
    };
    const listTree16X16 = {
        name: 'list_tree_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M10 5v2h4v2h-4v2h4v2H8V5H5V3h9v2zM2 5h2V3H2zm5 6H5v2h2zm0-4H5v2h2z"/></svg>`
    };
    const listTreeDatabase16X16 = {
        name: 'list_tree_database_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M13.953 11.81c.013-.011.032-.02.046-.031v.917c0 .33-.523.678-1.42.953a8.234 8.234 0 01-.694.178 16.116 16.116 0 01-3.382.328 16.089 16.089 0 01-3.38-.328 8.77 8.77 0 01-.693-.179c-.898-.274-1.42-.622-1.42-.952v-.917c.012.01.031.02.045.03a2.34 2.34 0 00.332.218l.03.017a4.235 4.235 0 00.46.202l.01.005.1.037c.053.018.11.034.164.05.093.031.186.062.283.09.033.01.064.022.1.031l.058.015c.184.048.378.092.58.132.043.009.084.018.13.026.214.042.438.078.666.11l.134.017c.21.028.425.051.646.072l.104.01c.242.021.487.037.731.049l.166.007c.251.01.504.016.754.016s.501-.007.754-.016l.164-.007c.246-.012.491-.028.734-.048l.102-.011c.22-.02.436-.044.649-.072.044-.006.09-.01.134-.017q.343-.048.664-.11c.046-.008.088-.017.132-.026q.3-.06.577-.13c.02-.007.043-.012.063-.017.034-.009.064-.021.099-.031.098-.028.189-.059.283-.09.052-.017.11-.032.16-.05.035-.012.07-.024.103-.037l.012-.005a4.252 4.252 0 00.457-.202c.013-.006.022-.013.032-.018a2.468 2.468 0 00.33-.216zm-5.45-2.946c-3.237 0-5.492.767-5.492 1.457 0 .33.523.679 1.42.952a9.998 9.998 0 00.694.179 16.101 16.101 0 003.378.327 16.12 16.12 0 003.382-.327 8.892 8.892 0 00.694-.18C13.477 11 14 10.652 14 10.322c0-.69-2.257-1.457-5.497-1.457zM14 6V5H5V3h2V2H2v1h2v5.581a9.632 9.632 0 011-.255V6h3v2h6V7H9V6z"/></svg>`
    };
    const lock16X16 = {
        name: 'lock_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M12 8V7a3.888 3.888 0 00-4-4 3.822 3.822 0 00-2.81 1.078A4.349 4.349 0 004.062 7v1H3v6h10V8zM6.062 6.986a2.407 2.407 0 01.566-1.516A1.834 1.834 0 018 5a1.883 1.883 0 012 2v1H6.062z"/></svg>`
    };
    const magnifyingGlass16X16 = {
        name: 'magnifying_glass_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M13.073 12.29l-2.926-2.926a3.971 3.971 0 10-.783.783l2.927 2.926zM7.01 9.84a2.83 2.83 0 112.83-2.83 2.833 2.833 0 01-2.83 2.83z"/></svg>`
    };
    const markdown16X16 = {
        name: 'markdown_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M14.25 3H1.75a.74.74 0 00-.75.73v8.54a.74.74 0 00.75.73h12.5a.74.74 0 00.75-.73V3.73a.74.74 0 00-.75-.73zm-6.285 7.059h-.991V7.773L5.982 9.35l-.99-1.577v2.286H4V5.934h.91L5.982 7.51l1.073-1.576h.91zm2.459.007L8.848 7.945h1.1V5.934h.99v2.01H12z"/></svg>`
    };
    const minus16X16 = {
        name: 'minus_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M4 7h8v2H4z"/></svg>`
    };
    const minusWide16X16 = {
        name: 'minus_wide_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M3 7h10v2H3z"/></svg>`
    };
    const mobile16X16 = {
        name: 'mobile_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M10.462 2.077H4.538A.54.54 0 004 2.615v10.77a.54.54 0 00.538.538h5.924a.54.54 0 00.538-.538V2.615a.54.54 0 00-.538-.538zM10 12H5V3h5z"/></svg>`
    };
    const notebook16X16 = {
        name: 'notebook_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M13 2h1v3h-1zm0 8h1V6h-1zm0 4h1v-3h-1zM4 7h6V6H4zm0-2h6V4H4zM2 2h10v12H2z"/></svg>`
    };
    const paste16X16 = {
        name: 'paste_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M9 5V3H3v6h2v1H2V2h8v3zM6 6v8h8V6z"/></svg>`
    };
    const pencil16X16 = {
        name: 'pencil_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M11.413 2.674c.326-.288 1.04-.013 1.807.857.768.869.952 1.61.626 1.898l-1.378 1.218-2.433-2.757zm-7.381 9.493l2.97-1.396-1.477.254.064-1.459-.48.25.156-1.013-1.754 2.774zm3.319-1.002L2 13.435 4.917 8.41l3.15-2.78L10.5 8.383zm4.293-3.866L9.21 4.544c-.177-.202.222-.543.394-.349l2.434 2.756c.175.2-.224.54-.394.348m-.783.7L8.428 5.244c-.178-.201.22-.542.393-.347l2.433 2.755c.176.199-.223.54-.393.347"/></svg>`
    };
    const potWithLid16X16 = {
        name: 'pot_with_lid_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M11 4V2H5v2H2v1h12V4zM6 4V3h4v1zm-4 9h1v1h10v-1h1V6H2z"/></svg>`
    };
    const question16X16 = {
        name: 'question_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M11.303 5.594a3.294 3.294 0 01-.195 1.176 2.63 2.63 0 01-.549.885 3.96 3.96 0 01-.852.672 7.46 7.46 0 01-1.121.54v1.501H6.27V8.15q.467-.125.845-.256a3.199 3.199 0 00.793-.429 2.098 2.098 0 00.608-.612 1.45 1.45 0 00.22-.791 1.042 1.042 0 00-.423-.939 2.163 2.163 0 00-1.195-.28 3.338 3.338 0 00-1.068.204 4.853 4.853 0 00-1.09.526h-.263V3.566a8.148 8.148 0 011.296-.372A8.205 8.205 0 017.77 3a4.196 4.196 0 012.579.718 2.241 2.241 0 01.954 1.876zM8.77 13H6.112v-1.737H8.77z"/></svg>`
    };
    const runningArrow16X16 = {
        name: 'running_arrow_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M14 7.985l-8.002 4.013L8 8 5.998 3.987zM3.995 2.997L2 2l3 6-3 6 2.002-1.005L6.5 8z"/></svg>`
    };
    const server16X16 = {
        name: 'server_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M13 3H3v3h10zM9 5H4V4h5zM3 7v3h10V7zm6 2H4V8h5zm3 4H3v-2h10v1a1 1 0 01-1 1z"/></svg>`
    };
    const shareSquare16X16 = {
        name: 'share_square_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M13.984 2.012l-2.069 6.153-.565-2.722-3.544 3.544-.822-.822 3.544-3.544-2.723-.566zM2 4v10h10v-4h-2v2H4V6h2V4z"/></svg>`
    };
    const shieldCheck16X16 = {
        name: 'shield_check_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M2 2v5.11C2 10.39 8 14 8 14s6-3.281 6-6.89V2zm4.788 8.2L4 7.388 5.225 6.2l1.553 1.61 4.06-4.01L12 5.013z"/></svg>`
    };
    const shieldXmark16X16 = {
        name: 'shield_xmark_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M2 2v5.11C2 10.39 8 14 8 14s6-3.281 6-6.89V2zm9.5 7.346L10.346 10.5 8 8.154 5.654 10.5 4.5 9.346 6.846 7 4.5 4.654 5.654 3.5 8 5.846 10.346 3.5 11.5 4.654 9.154 7z"/></svg>`
    };
    const signalBars16X16 = {
        name: 'signal_bars_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M4 14H2V2h2zm3-9H5v9h2zm3 3H8v6h2zm3 3h-2v3h2z"/></svg>`
    };
    const sineGraph16X16 = {
        name: 'sine_graph_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M14 12H2v-1.63a4.61 4.61 0 001.766-1.967c.636-1.06 1.082-1.705 1.902-1.705s1.266.644 1.902 1.705c.615 1.026 1.312 2.189 2.766 2.189 1.453 0 2.15-1.163 2.764-2.189a6.459 6.459 0 01.9-1.267zm0-6.054a4.613 4.613 0 00-1.764 1.967c-.635 1.061-1.08 1.705-1.9 1.705-.82 0-1.266-.644-1.902-1.705-.615-1.026-1.312-2.189-2.766-2.189S3.517 6.887 2.902 7.913A6.468 6.468 0 012 9.18V4h12z"/></svg>`
    };
    const skipArrow16X16 = {
        name: 'skip_arrow_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M10.002 8.29L2 12.304v-8.01zM14 2h-2v12h2z"/></svg>`
    };
    const spinner = {
        name: 'spinner',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M3.967 7.143h-.762a4.885 4.885 0 013.938-3.94v.771a4.123 4.123 0 00-3.176 3.169zM8 2v1.875A4.125 4.125 0 113.875 8H2a6 6 0 106-6z"/></svg>`
    };
    const squareCheck16X16 = {
        name: 'square_check_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M2 2v12h12V2zm4.788 9.2L4 8.387 5.225 7.2l1.553 1.61 4.06-4.01L12 6.013z"/></svg>`
    };
    const squareT16X16 = {
        name: 'square_t_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M2 2v12h12V2zm9.033 4.199l-.016-.076a2.34 2.34 0 00-.497-1.18 2.108 2.108 0 00-1.281-.26h-.56v5.941c0 .552.11.718.176.768a1.793 1.793 0 00.88.196l.09.006V12H6.193v-.405l.09-.007c.59-.046.8-.144.87-.218.06-.06.158-.255.158-.884V4.683h-.565a2.19 2.19 0 00-1.274.262 2.015 2.015 0 00-.498 1.174l-.015.08H4.49L4.565 4h6.859l.07 2.199z"/></svg>`
    };
    const t16X16 = {
        name: 't_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M5.684 13v-.729l.221-.018c.764-.058.947-.19.985-.229.026-.026.157-.202.157-.992V4.078H6.48a2.46 2.46 0 00-1.477.291 2.262 2.262 0 00-.563 1.36l-.038.196h-.797L3.704 3h8.6l.092 2.925h-.784l-.021-.095a2.817 2.817 0 00-.589-1.466c-.147-.131-.523-.286-1.48-.286H8.96V11.2c0 .679.138.819.165.84a2.092 2.092 0 001.01.213l.223.018V13z"/></svg>`
    };
    const tablet16X16 = {
        name: 'tablet_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M12.5 2h-9a.501.501 0 00-.5.5v11a.501.501 0 00.5.5h9a.501.501 0 00.5-.5v-11a.501.501 0 00-.5-.5zM8 13.25a.75.75 0 11.75-.75.752.752 0 01-.75.75zM12 11H4V3h8z"/></svg>`
    };
    const tag16X16 = {
        name: 'tag_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 17 16"><path class="cls-1" d="M8.044 3.588L5.23 3 3 5.229l.588 2.816L8.543 13 13 8.543zM6.5 6.499a1.082 1.082 0 11-.013-1.516A1.072 1.072 0 016.499 6.5z"/></svg>`
    };
    const tags16X16 = {
        name: 'tags_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 17 16"><path class="cls-1" d="M8.044 2.338L5.23 1.75 3 3.979l.588 2.816 4.955 4.955L13 7.293zM6.5 5.249a1.082 1.082 0 11-.013-1.516 1.072 1.072 0 01.013 1.516zm6.251 4.794L8.543 14.25 4.257 9.964l-.283-1.369 4.569 4.57L12.207 9.5z"/></svg>`
    };
    const targetCrosshairs16X16 = {
        name: 'target_crosshairs_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M8 6.01a2 2 0 102 2 2 2 0 00-2-2zm4.9.99A5.005 5.005 0 009 3.1V1H7v2.1A5.005 5.005 0 003.1 7H1v2h2.1A5.005 5.005 0 007 12.9V15h2v-2.1A5.005 5.005 0 0012.9 9H15V7zM8 12a4 4 0 114-4 4.005 4.005 0 01-4 4z"/></svg>`
    };
    const targetCrosshairsProgress16X16 = {
        name: 'target_crosshairs_progress_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M15 7v2h-2.1A5.005 5.005 0 019 12.9V15H7v-2.108a4.99 4.99 0 01-3.898-3.985l-1.52.583 2.003-4 1.998 4L4.11 8.9A3.999 3.999 0 107 4.13V1h2v2.1A5.005 5.005 0 0112.9 7zm-5 1.01a2 2 0 11-2-2 2 2 0 012 2z"/></svg>`
    };
    const threeDotsLine16X16 = {
        name: 'three_dots_line_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M8 6.5A1.5 1.5 0 116.5 8 1.5 1.5 0 018 6.5zM.5 8A1.5 1.5 0 102 6.5 1.5 1.5 0 00.5 8zm12 0A1.5 1.5 0 1014 6.5 1.5 1.5 0 0012.5 8z"/></svg>`
    };
    const thumbtack16X16 = {
        name: 'thumbtack_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M10 7l-.625-5H10V1H5v1h.625L5 7a2 2 0 00-2 2h4v4l.5 2 .5-2V9h4a2 2 0 00-2-2z"/></svg>`
    };
    const tileSize16X16 = {
        name: 'tile_size_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M2 8h6v6H2zm0-6v5h2V4h8v8H9v2h5V2z"/></svg>`
    };
    const times16X16 = {
        name: 'times_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M8 9.103L5.102 12 4 10.897 6.898 8 4 5.103 5.102 4 8 6.897 10.898 4 12 5.103 9.102 8 12 10.897 10.898 12 8 9.103z"/></svg>`
    };
    const trash16X16 = {
        name: 'trash_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M10 4V2H6v2H3v2h1v8h8V6h1V4zm-3 9H6V6h1zm2-9H7V3h2zm1 9H9V6h1z"/></svg>`
    };
    const triangle16X16 = {
        name: 'triangle_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M8 2L2 14h12zm0 4.875l2.438 4.875H5.585z"/></svg>`
    };
    const trueFalseRectangle16X16 = {
        name: 'true_false_rectangle_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M13.4 3.003H2.6a1.6 1.6 0 00-1.6 1.6v6.8a1.595 1.595 0 001.6 1.594h10.8a1.595 1.595 0 001.6-1.594v-6.8a1.6 1.6 0 00-1.6-1.6zM7.587 6.58H6.141v3.736H4.946V6.58H3.5v-.896h4.087zm4.913 0h-2.13v.862h1.974v.896H10.37v1.978H9.181V5.684H12.5z"/></svg>`
    };
    const unlink16X16 = {
        name: 'unlink_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M6.126 8.585c-.581.123-1.117.241-1.362.303a1.547 1.547 0 00-1.182 1.51l.01.155.021.193a1.69 1.69 0 00.216.54l.02.038.105.134.127.144.054.047a1.509 1.509 0 00.992.36h.049a1.306 1.306 0 00.224-.034l.03.015.006-.001c.463-.088.925-.186 1.387-.287l.343 1.538c-.488.11-.976.221-1.467.314a3.112 3.112 0 01-.571.053 3.148 3.148 0 01-2.99-2.258l-.011-.045a3.04 3.04 0 01-.076-.35 3.127 3.127 0 01-.03-.206l-.004-.089a3.112 3.112 0 01-.016-.336A3.164 3.164 0 014.35 7.356c.272-.068.808-.203.802-.206l.623-.137zm4.31-1.544l-.353 1.575c.737.176 1.38.334 1.413.346a1.514 1.514 0 01.789.768l.029.066.053.185.038.164.002.045a1.667 1.667 0 01-.035.58l-.064.185-.056.142a1.546 1.546 0 01-1.4.893 1.661 1.661 0 01-.313-.03 54.946 54.946 0 01-1.15-.24l-.347 1.55.406.097-.013-.017c.276.057.55.118.826.173a3.02 3.02 0 00.578.056 3.188 3.188 0 002.811-1.74 3.018 3.018 0 00.129-.311l.033-.083.061-.197a3.047 3.047 0 00.082-.351l.008-.044a3.132 3.132 0 00-2.281-3.513c-.297-.077-.777-.19-1.245-.299M7.932 2.393L6.875 6.075h.75l.3 3.032 1.2-3.782h-.75z"/></svg>`
    };
    const unlock16X16 = {
        name: 'unlock_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M6.062 8V5.986a2.407 2.407 0 01.566-1.516A1.834 1.834 0 018 4a1.883 1.883 0 012 2h2a3.888 3.888 0 00-4-4 3.822 3.822 0 00-2.81 1.078A4.349 4.349 0 004.062 6v2H3v6h10V8z"/></svg>`
    };
    const upload16X16 = {
        name: 'upload_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M14 9v5H2V9h1v4h10V9zM7.982 2L5 7.9l2.004-1.312L7 11h2V6.613L11 7.9z"/></svg>`
    };
    const user16X16 = {
        name: 'user_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M8.004 2a2.18 2.18 0 012.184 2.182v1.09c.647 0 .378.932 0 1.455a4.275 4.275 0 01-.335.364 8.55 8.55 0 01-.31.742l.208 1.076h.437l2.75 1.527A2.148 2.148 0 0114 12.291V14H2v-1.673a2.163 2.163 0 011.063-1.869l2.758-1.55h.437l.21-1.068a8.52 8.52 0 01-.312-.749 4.275 4.275 0 01-.335-.364c-.378-.523-.647-1.454 0-1.454v-1.09A2.18 2.18 0 018.004 2"/></svg>`
    };
    const watch16X16 = {
        name: 'watch_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M12.57 7.28l-.06.013a4.556 4.556 0 00-1.38-2.609V3.44a.481.481 0 00-.48-.48h-.48V2H5.85v.96h-.48a.481.481 0 00-.48.48v1.24a4.545 4.545 0 000 6.64v1.24a.481.481 0 00.48.48h.48V14h4.32v-.96h.48a.481.481 0 00.48-.48v-1.24a4.547 4.547 0 001.379-2.612l.061.012a.481.481 0 00.48-.48v-.48a.481.481 0 00-.48-.48zm-2.3 2.662a1.59 1.59 0 00-.182-.26L8.747 8.338a.785.785 0 000-.666c.132-.133.894-.899.965-1a1.216 1.216 0 00.14-.485 1.004 1.004 0 00-.515.157l-.955.957a.784.784 0 100 1.408c.163.167.956.974 1.236 1.254a1.477 1.477 0 00.36.276 3.055 3.055 0 11.291-.297z"/></svg>`
    };
    const waveform16X16 = {
        name: 'waveform_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M9.77 11.225c-1.582 0-2.076-1.262-2.512-2.376l-.17-.426a26.242 26.242 0 01-.218-.595c-.32-.9-.41-1.046-.652-1.046-.24 0-.308.065-.612.88-.088.237-.188.504-.317.801l-.098.238c-.486 1.178-1.037 2.513-2.747 2.513H2V9.221h.444c.318 0 .48-.316.9-1.292l.133-.307c.06-.148.121-.304.181-.457.435-1.116.927-2.382 2.56-2.382 1.59 0 2.063 1.274 2.48 2.398l.168.443c.082.205.155.396.221.572.345.905.427 1.03.684 1.03.259 0 .409-.317.742-1.157.08-.201.167-.42.266-.652l.097-.228c.477-1.127 1.016-2.405 2.668-2.412l.444-.002L14 6.782h-.447c-.367 0-.506.245-.994 1.387 0 0-.179.434-.238.584-.433 1.101-.973 2.472-2.55 2.472z"/></svg>`
    };
    const webviCustom16X16 = {
        name: 'webvi_custom_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M8 2a6 6 0 106 6 6 6 0 00-6-6zm4.089 2.526h-1.868a5.598 5.598 0 00-.854-1.712 5.363 5.363 0 012.722 1.712zm-2.722 8.66a5.599 5.599 0 00.854-1.712h1.868a5.363 5.363 0 01-2.722 1.712zm3.181-2.344h-2.146a10.644 10.644 0 00.208-1.187L9.923 10c-.05.294-.106.58-.176.843h-1.51l-1.263.632h2.583C9.145 12.647 8.554 13.368 8 13.368c-.517 0-1.065-.633-1.47-1.672l-.56.28a5.018 5.018 0 00.663 1.21 5.363 5.363 0 01-2.722-1.712h.317a.955.955 0 01-.017-.17v-.462h-.76a5.33 5.33 0 01-.804-2.526h1.564v-.632H2.646a5.33 5.33 0 01.805-2.526h.759V4.69a.95.95 0 01.016-.164h-.316a5.363 5.363 0 012.722-1.712 5.017 5.017 0 00-.663 1.207l.56.28c.406-1.037.953-1.67 1.47-1.67.554 0 1.145.722 1.557 1.895H6.98l1.261.632h1.507c.07.263.126.548.176.842l.687.344a10.66 10.66 0 00-.208-1.186h2.146a5.33 5.33 0 01.804 2.526h-.67a.92.92 0 01-.001.632h.671a5.33 5.33 0 01-.804 2.526zM12.105 8a.326.326 0 01-.19.296l-6.598 3.3-.148.036a.327.327 0 01-.327-.328V4.69a.327.327 0 01.492-.281l6.595 3.302a.326.326 0 01.176.29z"/></svg>`
    };
    const webviHost16X16 = {
        name: 'webvi_host_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M8 2a6 6 0 106 6 6 6 0 00-6-6zm4.09 2.526H10.22a5.6 5.6 0 00-.854-1.712 5.364 5.364 0 012.722 1.712zm-2.723 8.66a5.6 5.6 0 00.854-1.712h1.868a5.363 5.363 0 01-2.722 1.712zm3.181-2.344h-2.146a10.657 10.657 0 00.208-1.187L9.923 10a9.85 9.85 0 01-.176.843h-1.51l-1.263.632h2.583C9.145 12.647 8.554 13.368 8 13.368c-.517 0-1.064-.633-1.47-1.672l-.56.28a5.02 5.02 0 00.663 1.21 5.363 5.363 0 01-2.722-1.712h.317a.96.96 0 01-.017-.17v-.462h-.76a5.33 5.33 0 01-.804-2.526H4.21v-.632H2.647a5.33 5.33 0 01.805-2.526h.759V4.69a.95.95 0 01.016-.164h-.316a5.364 5.364 0 012.722-1.712 5.02 5.02 0 00-.663 1.207l.56.28c.406-1.037.953-1.67 1.47-1.67.554 0 1.145.722 1.557 1.895H6.98l1.262.632h1.506c.07.263.126.548.176.842l.687.344a10.646 10.646 0 00-.208-1.186h2.146a5.33 5.33 0 01.804 2.526h-.67a.92.92 0 01-.001.632h.671a5.33 5.33 0 01-.804 2.526zm-.619-3.131L5.334 4.409a.327.327 0 00-.492.281v6.613a.327.327 0 00.327.328l.148-.035 6.598-3.3a.326.326 0 00.014-.585zm-6.087 2.505V5.78L10.274 8z"/></svg>`
    };
    const windowCode16X16 = {
        name: 'window_code_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M2 2v12h12V2zm11 11H3V5h10zM4 9.135l2.698-1.118v.75l-1.588.65 1.588.646v.75l-2.694-1.12zm4.42-1.49h.792l-1.565 3.71h-.783zM12 9.135v.557l-2.694 1.12v-.75l.062-.024 1.526-.626-1.588-.648v-.747z"/></svg>`
    };
    const windowText16X16 = {
        name: 'window_text_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M2 2v12h12V2zm11 11H3V5h10zM7 8H4V6h3zm5 2H4V9h8zm0 2H4v-1h8z"/></svg>`
    };
    const wrenchHammer16X16 = {
        name: 'wrench_hammer_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M12.286 11.714l-5.791-5.79a2.504 2.504 0 00.17-.755 2.149 2.149 0 00-.095-.814 2.12 2.12 0 00-.55-.904 2.328 2.328 0 00-1.76-.685h-.045a2.104 2.104 0 00-.718.155l1.102 1.104.32.32.244.245a1.864 1.864 0 01-.22.854 1.043 1.043 0 01-.114.145 1.648 1.648 0 01-1.003.335L2.61 4.704l-.449-.449a2.074 2.074 0 00-.135.545l-.015.105a2.337 2.337 0 00.384 1.518 2.51 2.51 0 00.295.36 2.205 2.205 0 001.576.65 2.453 2.453 0 00.898-.175l4.793 4.796 1.203 1.2h.668l.663-.665v-.67zM5.75 8.908l1.367 1.367-2.988 2.987h-.923l-.45-.45v-.916zM14 5.906l-1.81 1.809-1.298-1.216-1.38 1.38-1.367-1.365 1.374-1.382-1.622-1.62.683-.774 2.252.45z"/></svg>`
    };
    const xmark16X16 = {
        name: 'xmark_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M13 4.667L9.667 7.999 13 11.333 11.333 13 8 9.667 4.667 13 3 11.333 6.333 8 3 4.667 4.667 3 8 6.333 11.333 3z"/></svg>`
    };
    const xmarkCheck16X16 = {
        name: 'xmark_check_16_x_16',
        data: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path class="cls-1" d="M8.033 14.026L4.9 10.866 6.277 9.53l1.744 1.81 4.562-4.507 1.307 1.363zm1.155-10.68l-1.321-1.32-2.312 2.311-2.311-2.311-1.321 1.32 2.311 2.312L1.923 7.97l1.32 1.32 2.312-2.31 2.312 2.31 1.32-1.32-2.31-2.312z"/></svg>`
    };

    /**
     * This file is a workaround for: https://github.com/prettier/prettier/issues/11400
     */
    /**
     * The string representing the focus selector to be used. Value
     * will be ":focus-visible" when https://drafts.csswg.org/selectors-4/#the-focus-visible-pseudo
     * is supported and ":focus" when it is not.
     *
     * @public
     */
    const focusVisible = `:${focusVisible$1}`;

    const styles$k = css `
    ${display('inline-flex')}

    :host {
        height: ${controlHeight};
        box-sizing: border-box;
        font: ${bodyFont};
        color: ${bodyFontColor};
        padding-left: calc(4px - ${borderWidth});
    }

    .listitem {
        display: flex;
        align-items: center;
    }

    .control {
        color: var(--ni-private-breadcrumb-link-font-color);
        cursor: default;
        display: flex;
        align-items: center;
        justify-content: center;
        border: ${borderWidth} solid transparent;
        padding-right: calc(4px - ${borderWidth});
    }

    .control:link {
        cursor: pointer;
        text-decoration: none;
    }

    .control:hover {
        text-decoration: underline;
    }

    .control:active {
        color: var(--ni-private-breadcrumb-link-active-font-color);
        text-decoration: underline;
    }

    .control:link${focusVisible} {
        border: ${borderWidth} solid ${borderHoverColor};
        outline: 2px solid ${borderHoverColor};
        outline-offset: 1px;
    }

    .start,
    .end {
        display: flex;
        align-items: center;
    }

    .start {
        margin-inline-end: 4px;
    }

    slot[name='separator'] {
        display: flex;
        align-items: center;
    }

    slot[name='separator'] svg {
        width: ${iconSize};
        height: ${iconSize};
    }

    slot[name='separator'] path {
        fill: ${placeholderFontColor};
    }
`;

    /**
     * A nimble-styled breadcrumb item
     */
    class BreadcrumbItem extends BreadcrumbItem$1 {
    }
    const nimbleBreadcrumbItem = BreadcrumbItem.compose({
        baseName: 'breadcrumb-item',
        baseClass: BreadcrumbItem$1,
        template: breadcrumbItemTemplate,
        styles: styles$k,
        separator: forwardSlash16X16.data
    });
    DesignSystem.getOrCreate()
        .withPrefix('nimble')
        .register(nimbleBreadcrumbItem());

    /**
     * Behavior that will conditionally apply a stylesheet based on the element's
     * appearance property
     *
     * @param value - The value of the appearance property
     * @param styles - The styles to be applied when condition matches
     *
     * @public
     */
    function appearanceBehavior(value, styles) {
        return new PropertyStyleSheetBehavior('appearance', value, styles);
    }

    /**
     * Types of button appearance.
     * @public
     */
    var ButtonAppearance;
    (function (ButtonAppearance) {
        ButtonAppearance["Outline"] = "outline";
        ButtonAppearance["Ghost"] = "ghost";
        ButtonAppearance["Block"] = "block";
    })(ButtonAppearance || (ButtonAppearance = {}));

    const styles$j = css `
    ${display('inline-flex')}

    :host {
        background-color: transparent;
        height: ${controlHeight};
        color: ${buttonLabelFontColor};
        font: ${buttonLabelFont};
        cursor: pointer;
        outline: none;
        border: none;
        box-sizing: border-box;
        ${
/*
    Not sure why but this is needed to get buttons with icons and buttons
    without icons to align on the same line when the button is inline-flex
    See: https://github.com/microsoft/fast/issues/5414
*/ ''}
        vertical-align: middle;
    }

    :host([disabled]) {
        color: ${buttonLabelDisabledFontColor};
        cursor: default;
    }

    .control {
        background-color: transparent;
        height: 100%;
        width: 100%;
        border: ${borderWidth} solid transparent;
        box-sizing: border-box;
        color: inherit;
        border-radius: inherit;
        fill: inherit;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        cursor: inherit;
        font: inherit;
        outline: none;
        margin: 0;
        padding: 0 ${standardPadding};
        transition: box-shadow ${smallDelay};
    }

    :host([content-hidden]) .control {
        width: ${controlHeight};
        padding: 0px;
    }

    @media (prefers-reduced-motion) {
        .control {
            transition-duration: 0s;
        }
    }

    .control:hover {
        box-shadow: 0px 0px 0px ${borderWidth} ${borderHoverColor} inset;
        outline: none;
    }

    .control${focusVisible} {
        box-shadow: 0px 0px 0px ${borderWidth} ${borderHoverColor} inset;
        outline: ${borderWidth} solid ${borderHoverColor};
        outline-offset: -4px;
    }

    .control:active {
        box-shadow: none;
        outline: none;
    }

    .control[disabled] {
        box-shadow: none;
        outline: none;
    }

    .content {
        display: contents;
    }

    :host([content-hidden]) .content {
        ${
/**
 * Hide content visually while keeping it screen reader-accessible.
 * Source: https://webaim.org/techniques/css/invisiblecontent/#techniques
 * See discussion here: https://github.com/microsoft/fast/issues/5740#issuecomment-1068195035
 */
''}
        display: inline-block;
        height: 1px;
        width: 1px;
        position: absolute;
        margin: -1px;
        clip: rect(1px, 1px, 1px, 1px);
        clip-path: inset(50%);
        overflow: hidden;
        padding: 0;
    }

    [part='start'] {
        display: contents;
        ${iconColor.cssCustomProperty}: ${buttonLabelFontColor};
    }

    :host([disabled]) slot[name='start']::slotted(*) {
        opacity: 0.6;
    }

    [part='end'] {
        display: contents;
        ${iconColor.cssCustomProperty}: ${buttonLabelFontColor};
    }

    :host([content-hidden]) [part='end'] {
        display: none;
    }
`
        // prettier-ignore
        .withBehaviors(appearanceBehavior(ButtonAppearance.Outline, css `
                .control {
                    background-color: transparent;
                    border-color: rgba(${actionRgbPartialColor}, 0.3);
                }

                .control:hover {
                    background-color: transparent;
                    border-color: ${borderHoverColor};
                }

                .control${focusVisible} {
                    background-color: transparent;
                    border-color: ${borderHoverColor};
                }

                .control:active {
                    background-color: ${fillSelectedColor};
                    border-color: ${fillSelectedColor};
                }

                .control[disabled] {
                    background-color: transparent;
                    border-color: rgba(${borderRgbPartialColor}, 0.2);
                }
            `), appearanceBehavior(ButtonAppearance.Ghost, css `
                .control {
                    background-color: transparent;
                    border-color: transparent;
                }

                .control:hover {
                    background-color: transparent;
                    border-color: ${borderHoverColor};
                }

                .control${focusVisible} {
                    background-color: transparent;
                    border-color: ${borderHoverColor};
                }

                .control:active {
                    background-color: ${fillSelectedColor};
                    border-color: ${fillSelectedColor};
                }

                .control[disabled] {
                    background-color: transparent;
                    border-color: transparent;
                }
            `), appearanceBehavior(ButtonAppearance.Block, css `
                .control {
                    background-color: rgba(${borderRgbPartialColor}, 0.1);
                    border-color: transparent;
                }

                .control:hover {
                    background-color: transparent;
                    border-color: ${borderHoverColor};
                }

                .control${focusVisible} {
                    background-color: rgba(${borderRgbPartialColor}, 0.1);
                    border-color: ${borderHoverColor};
                }

                .control${focusVisible}:hover {
                    background-color: transparent;
                }

                .control:active {
                    background-color: ${fillSelectedColor};
                    border-color: ${fillSelectedColor};
                }

                .control[disabled] {
                    background-color: rgba(${borderRgbPartialColor}, 0.1);
                    border-color: transparent;
                }
            `));

    // prettier-ignore
    const styles$i = styles$j
        .withBehaviors(appearanceBehavior(ButtonAppearance.Outline, css `
                :host(.primary) .control {
                    box-shadow: 0px 0px 0px ${borderWidth} rgba(${actionRgbPartialColor}, 0.3) inset;
                }

                :host(.primary) .control:hover {
                    box-shadow: 0px 0px 0px ${borderWidth} ${borderHoverColor} inset;
                }

                :host(.primary) .control${focusVisible} {
                    box-shadow: 0px 0px 0px ${borderWidth} ${borderHoverColor} inset;
                }

                :host(.primary) .control:active {
                    box-shadow: none;
                }

                :host(.primary) .control[disabled] {
                    box-shadow: none;
                }
            `), appearanceBehavior(ButtonAppearance.Block, css `
                :host(.primary) .control {
                    background-clip: padding-box;
                    border-color: rgba(${actionRgbPartialColor}, 0.3);
                    border-width: calc(2 * ${borderWidth});
                    padding: 0 calc(${standardPadding} - ${borderWidth});
                }

                :host(.primary[content-hidden]) .control {
                    padding: 0px;
                }

                :host(.primary) .control:hover {
                    border-color: ${borderHoverColor};
                    box-shadow: none;
                }

                :host(.primary) .control${focusVisible} {
                    background-clip: border-box;
                    border-color: ${borderHoverColor};
                    border-width: ${borderWidth};
                    box-shadow: 0px 0px 0px ${borderWidth} ${borderHoverColor} inset;
                    padding: 0 ${standardPadding};
                }

                :host(.primary[content-hidden]) .control${focusVisible} {
                    padding: 0px;
                }

                :host(.primary) .control:active {
                    background-clip: border-box;
                    border-color: ${fillSelectedColor};
                    border-width: ${borderWidth};
                    box-shadow: none;
                    padding: 0 ${standardPadding};
                }

                :host(.primary[content-hidden]) .control:active {
                    padding: 0px;
                }

                :host(.primary) .control[disabled] {
                    background-clip: border-box;
                    border-color: transparent;
                    border-width: ${borderWidth};
                    box-shadow: none;
                    padding: 0 ${standardPadding};
                }

                :host(.primary[content-hidden]) .control[disabled] {
                    padding: 0px;
                }
            `));

    /**
     * A nimble-styled HTML button
     */
    class Button extends Button$1 {
        constructor() {
            super(...arguments);
            /**
             * The appearance the button should have.
             *
             * @public
             * @remarks
             * HTML Attribute: appearance
             */
            this.appearance = ButtonAppearance.Outline;
            /**
             * Specify as 'true' to hide the text content of the button. The button will
             * become square, and the text content will be used as the label of the button
             * for accessibility purposes.
             *
             * @public
             * @remarks
             * HTML Attribute: content-hidden
             */
            this.contentHidden = false;
        }
    }
    __decorate([
        attr
    ], Button.prototype, "appearance", void 0);
    __decorate([
        attr({ attribute: 'content-hidden', mode: 'boolean' })
    ], Button.prototype, "contentHidden", void 0);
    /**
     * A function that returns a nimble-button registration for configuring the component with a DesignSystem.
     * Implements {@link @microsoft/fast-foundation#buttonTemplate}
     *
     * @public
     * @remarks
     * Generates HTML Element: \<nimble-button\>
     *
     */
    const nimbleButton = Button.compose({
        baseName: 'button',
        baseClass: Button$1,
        template: buttonTemplate,
        styles: styles$i,
        shadowOptions: {
            delegatesFocus: true
        }
    });
    DesignSystem.getOrCreate().withPrefix('nimble').register(nimbleButton());

    const styles$h = css `
    ${display('inline-flex')}

    :host {
        font: ${buttonLabelFont};
        align-items: center;
        cursor: pointer;
        outline: none;
        user-select: none;
    }

    :host([disabled]) {
        cursor: default;
    }

    .control {
        width: calc(${controlHeight} / 2);
        height: calc(${controlHeight} / 2);
        box-sizing: border-box;
        flex-shrink: 0;
        border: ${borderWidth} solid ${borderColor};
        padding: 2px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: box-shadow ${smallDelay};
        ${
/*
 * Firefox includes the line height in the outline height calculation (not sure if intended or accidental).
 * Set it to 0 to ensure the outline is just as high as the control.
 */ ''}
        line-height: 0;
    }

    @media (prefers-reduced-motion) {
        .control {
            transition-duration: 0s;
        }
    }

    :host([disabled]) .control {
        background-color: rgba(${borderRgbPartialColor}, 0.1);
        border-color: rgba(${borderRgbPartialColor}, 0.2);
    }

    :host(:not([disabled]):not(:active):hover) .control {
        border-color: ${borderHoverColor};
        box-shadow: 0px 0px 0px ${borderWidth} ${borderHoverColor} inset;
    }

    :host(${focusVisible}) .control {
        border-color: ${borderHoverColor};
        outline: 2px solid ${borderHoverColor};
        outline-offset: 2px;
    }

    .label {
        font: inherit;
        color: ${bodyFontColor};
        padding-left: 1ch;
        cursor: inherit;
    }

    :host([disabled]) .label {
        color: ${bodyDisabledFontColor};
    }

    slot[name='checked-indicator'] svg {
        height: ${iconSize};
        width: ${iconSize};
        overflow: visible;
    }

    slot[name='checked-indicator'] path {
        fill: ${borderColor};
        opacity: 0;
    }

    :host([aria-checked='true']) slot[name='checked-indicator'] path {
        opacity: 1;
    }

    :host([disabled]) slot[name='checked-indicator'] path {
        fill: rgba(${borderRgbPartialColor}, 0.3);
    }
`;

    /**
     * A nimble-styled checkbox control.
     */
    class Checkbox extends Checkbox$1 {
    }
    const nimbleCheckbox = Checkbox.compose({
        baseName: 'checkbox',
        baseClass: Checkbox$1,
        template: checkboxTemplate,
        styles: styles$h,
        checkedIndicator: check16X16.data
    });
    DesignSystem.getOrCreate().withPrefix('nimble').register(nimbleCheckbox());

    var commonjsGlobal = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};

    var dist = {};

    var animateTo = {};

    var animate = {};

    (function (exports) {
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.AnimationMode = void 0;
    /**
     * Animation mode describes if an animation should animate toward an elements natural position or away from it
     *
     * @internal
     */
    var AnimationMode;
    (function (AnimationMode) {
        AnimationMode[AnimationMode["animateTo"] = 0] = "animateTo";
        AnimationMode[AnimationMode["animateFrom"] = 1] = "animateFrom";
    })(AnimationMode = exports.AnimationMode || (exports.AnimationMode = {}));
    /**
     * Base animate type. This is extended by {@link @microsoft/fast-animation#AnimateTo} and {@link @microsoft/fast-animation#AnimateFrom}.
     *
     * @public
     */
    var Animate = /** @class */ (function () {
        function Animate(element, options, effectTiming) {
            var _this = this;
            /**
             * Stores animation timing functions
             */
            this.effectTiming = {
                fill: "forwards",
                iterations: 1,
                duration: 500,
            };
            /**
             * Stores animation keyframe sets and is accessed by a getter
             */
            this._keyframes = [];
            /**
             * plays the animation
             */
            this.play = function () {
                _this.ensureAnimationObjectExists();
                _this.animation.play();
            };
            /**
             * pauses the animation
             */
            this.pause = function () {
                _this.ensureAnimationObjectExists();
                _this.animation.pause();
            };
            /**
             * finishes the animation
             */
            this.finish = function () {
                _this.ensureAnimationObjectExists();
                _this.animation.finish();
            };
            /**
             * cancels the animation
             */
            this.cancel = function () {
                _this.ensureAnimationObjectExists();
                _this.animation.cancel();
            };
            /**
             * reverses an animation
             */
            this.reverse = function () {
                _this.ensureAnimationObjectExists();
                _this.animation.reverse();
            };
            /**
             * adds a set of keyframes to set of animation keyframes the animation should execute
             */
            this.addKeyframes = function (keyframes) {
                _this._keyframes.push(keyframes);
            };
            this.animationTarget = element;
            if (effectTiming) {
                this.effectTiming = Object.assign({}, this.effectTiming, effectTiming);
            }
            if (options) {
                if (options.transformOrigin) {
                    element.style.transformOrigin = options.transformOrigin;
                }
                if (options.transformStyle) {
                    element.style.transformStyle = options.transformStyle;
                }
            }
            this.options = options || {};
        }
        Object.defineProperty(Animate.prototype, "onFinish", {
            get: function () {
                return this._onFinish;
            },
            set: function (callback) {
                this._onFinish = callback;
                if (this.animation) {
                    this.animation.onfinish = callback;
                }
            },
            enumerable: false,
            configurable: true
        });
        /**
         * Ensure animation object
         */
        Animate.prototype.ensureAnimationObjectExists = function () {
            if (typeof this.animation === "undefined") {
                this.createAnimationObject();
            }
        };
        /**
         * Creates the animation object
         */
        Animate.prototype.createAnimationObject = function () {
            this.animation = new Animation(this.keyframeEffect, document.timeline);
            if (typeof this.onFinish !== "undefined") {
                this.animation.onfinish = this.onFinish;
            }
            if (typeof this.onCancel !== "undefined") {
                this.animation.oncancel = this.onCancel;
            }
        };
        /**
         * Returns a list of properties that will be animated based options
         */
        Animate.prototype.getPropertiesToAnimate = function () {
            var _this = this;
            return Object.keys(Animate.propertyMap).filter(function (property) {
                // Filter out all properties that don't need to be set based on our options
                return Animate.propertyMap[property].reduce(function (hasProperty, animationProp) {
                    return (typeof _this.options[animationProp] !== "undefined" || hasProperty);
                }, false);
            });
        };
        /**
         * Current implmentations of web animations seem to have trouble animating both scale and opacity
         * from a starting value of 0. This method detects when those values are 0 and alters them slightly
         * to known-working starting values
         */
        Animate.prototype.normalizeInitialValue = function (property, value) {
            if (value === undefined) {
                return;
            }
            var coercedReturn = "0.01";
            switch (property) {
                case "transform":
                    /* eslint-disable */
                    var matrixValuesRegex = /matrix\((.+)\)/;
                    var matrixValues = value.match(matrixValuesRegex);
                    /* eslint-enable */
                    if (Array.isArray(matrixValues)) {
                        var normalizedValues = matrixValues[1]
                            .split(",")
                            .map(function (matchedValue, index) {
                            var parsedValueIsZero = parseFloat(value) === 0;
                            if (!parsedValueIsZero) {
                                return matchedValue;
                            }
                            // If this is the scaleX index or the scaleY index, return the coerced value
                            return index === 0 || index === 3
                                ? coercedReturn
                                : matchedValue;
                        });
                        return "matrix(" + normalizedValues.join(",") + ")";
                    }
                    break;
                case "opacity":
                    return parseFloat(value) === 0 ? coercedReturn : value;
            }
            return value;
        };
        /**
         * Returns the initial values for all properties being animated
         */
        Animate.prototype.getInitialKeyframeValues = function () {
            var _this = this;
            if (!(this.animationTarget instanceof HTMLElement) ||
                typeof window === "undefined") {
                return {};
            }
            var animatedProperties = this.getPropertiesToAnimate();
            var computedStyle = window.getComputedStyle(this.animationTarget);
            var initialKeyframeValues = {};
            animatedProperties.forEach(function (property) {
                initialKeyframeValues[property] = _this.normalizeInitialValue(property, computedStyle[property]);
            });
            return initialKeyframeValues;
        };
        /**
         * Formats a config option into a transform function
         */
        Animate.prototype.formatTransformFunction = function (functionType, value) {
            // If `functionType` can't be converted into a transform function, just return empty string
            if (Animate.propertyMap.transform.indexOf(functionType) === -1) {
                return "";
            }
            switch (functionType) {
                case "x":
                case "y":
                    functionType = "translate" + functionType.toUpperCase();
                    value =
                        typeof value === "number" ? (value = this.pixelify(value)) : value;
                    break;
                case "rotate":
                    value = value.toString() + "deg";
                    break;
                case "scale":
                    if (value === 0) {
                        // There is a strange bug where you can't animate from a scale 0
                        value = 0.01;
                    }
            }
            if (typeof value !== "string") {
                value = value.toString();
            }
            return functionType + "(" + value + ")";
        };
        /**
         * Converts a number to a pixel string
         */
        Animate.prototype.pixelify = function (num) {
            return num + "px";
        };
        /**
         * Returns keyframe values based on option configuration
         */
        Animate.prototype.getOptionKeyframeValues = function () {
            var _this = this;
            var animateProperties = this.getPropertiesToAnimate();
            var keyframeValues = {};
            animateProperties.forEach(function (property) {
                keyframeValues[property] = Animate.propertyMap[property]
                    .map(function (option) {
                    var value = _this.options[option];
                    if (typeof value === "undefined") {
                        return null;
                    }
                    switch (option) {
                        case "opacity":
                            return value.toString();
                        case "top":
                        case "right":
                        case "bottom":
                        case "left":
                            return typeof value === "number"
                                ? _this.pixelify(value)
                                : value;
                        default:
                            return _this.formatTransformFunction(option, value);
                    }
                })
                    .filter(function (option) { return Boolean(option); })
                    .join(" ");
            });
            return keyframeValues;
        };
        /**
         * Gets all keyframes configured by options
         */
        Animate.prototype.getOptionKeyframes = function () {
            var keyframes = [
                this.getInitialKeyframeValues(),
                this.getOptionKeyframeValues(),
            ];
            return this.mode === AnimationMode.animateFrom ? keyframes.reverse() : keyframes;
        };
        /**
         * Sorts an array of offset keys in ascending order
         */
        Animate.prototype.sortOffsets = function (offsets) {
            return offsets.sort(function (a, b) {
                var A = parseFloat(a);
                var B = parseFloat(b);
                if (A < B) {
                    return -1;
                }
                else if (A > B) {
                    return 1;
                }
                else {
                    return 0;
                }
            });
        };
        /**
         * Consolidates all keyframe arrays into a single keyframe array
         */
        Animate.prototype.consolidateKeyframes = function (keyframeSets) {
            var frames = [];
            // Merge all keyframes into a single frames object where each key is a keyframe offset
            keyframeSets.forEach(function (keyframeSet) {
                keyframeSet.forEach(function (keyframe, index) {
                    var offset = keyframe.offset;
                    if (typeof offset === "undefined") {
                        offset = index === 0 ? 0 : 1;
                        keyframe.offset = offset;
                    }
                    var offsetKey = offset.toString();
                    frames[offsetKey] =
                        typeof frames[offsetKey] === "undefined"
                            ? keyframe
                            : Object.assign(frames[offsetKey], keyframe);
                });
            });
            return this.sortOffsets(Object.keys(frames)).map(function (offset) {
                return frames[offset];
            });
        };
        Object.defineProperty(Animate.prototype, "keyframes", {
            /**
             * Returns the animation's keyframes
             */
            get: function () {
                return this.consolidateKeyframes(this._keyframes.concat([this.getOptionKeyframes()]));
            },
            enumerable: false,
            configurable: true
        });
        Object.defineProperty(Animate.prototype, "keyframeEffect", {
            /**
             * Returns the key frame effect object
             */
            get: function () {
                return new KeyframeEffect(this.animationTarget, this.keyframes, this.effectTiming);
            },
            enumerable: false,
            configurable: true
        });
        /**
         * A mapping between animation options and the css property names they apply to
         */
        Animate.propertyMap = {
            opacity: ["opacity"],
            transform: ["x", "y", "rotate", "scale"],
            top: ["top"],
            left: ["left"],
            bottom: ["bottom"],
            right: ["right"],
        };
        return Animate;
    }());
    exports.default = Animate;
    }(animate));

    var __extends$4 = (commonjsGlobal && commonjsGlobal.__extends) || (function () {
        var extendStatics = function (d, b) {
            extendStatics = Object.setPrototypeOf ||
                ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
                function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
            return extendStatics(d, b);
        };
        return function (d, b) {
            extendStatics(d, b);
            function __() { this.constructor = d; }
            d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
        };
    })();
    Object.defineProperty(animateTo, "__esModule", { value: true });
    var animate_1$1 = animate;
    /**
     * An animation to provided property values from the element's current values.
     * Extends {@link @microsoft/fast-animation#Animate}.
     * @public
     */
    var AnimateTo = /** @class */ (function (_super) {
        __extends$4(AnimateTo, _super);
        function AnimateTo() {
            var _this = _super !== null && _super.apply(this, arguments) || this;
            _this.mode = animate_1$1.AnimationMode.animateTo;
            return _this;
        }
        return AnimateTo;
    }(animate_1$1.default));
    animateTo.default = AnimateTo;

    var animateFrom = {};

    var __extends$3 = (commonjsGlobal && commonjsGlobal.__extends) || (function () {
        var extendStatics = function (d, b) {
            extendStatics = Object.setPrototypeOf ||
                ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
                function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
            return extendStatics(d, b);
        };
        return function (d, b) {
            extendStatics(d, b);
            function __() { this.constructor = d; }
            d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
        };
    })();
    Object.defineProperty(animateFrom, "__esModule", { value: true });
    var animate_1 = animate;
    /**
     * An animation from provided property values to the element's current values.
     * Extends {@link @microsoft/fast-animation#Animate}.
     *
     * @public
     */
    var AnimateFrom = /** @class */ (function (_super) {
        __extends$3(AnimateFrom, _super);
        function AnimateFrom() {
            var _this = _super !== null && _super.apply(this, arguments) || this;
            _this.mode = animate_1.AnimationMode.animateFrom;
            return _this;
        }
        return AnimateFrom;
    }(animate_1.default));
    animateFrom.default = AnimateFrom;

    var animateGroup = {};

    var invokeFunctionForEach$1 = {};

    Object.defineProperty(invokeFunctionForEach$1, "__esModule", { value: true });
    invokeFunctionForEach$1.invokeFunctionForEach = void 0;
    /**
     * For each item in an array, invoke a function
     */
    function invokeFunctionForEach(arr, name) {
        arr.forEach(function (arrItem) { return arrItem[name](); });
    }
    invokeFunctionForEach$1.invokeFunctionForEach = invokeFunctionForEach;

    Object.defineProperty(animateGroup, "__esModule", { value: true });
    var invokeFunctionForEach_1$1 = invokeFunctionForEach$1;
    /**
     * Groups {@link @microsoft/fast-animation#AnimateTo} and {@link @microsoft/fast-animation#AnimateFrom} instances, providing a single API to operate on all of them.
     * @public
     */
    var AnimateGroup = /** @class */ (function () {
        function AnimateGroup(animations) {
            var _this = this;
            /**
             * Pauses all animations in the group
             */
            this.pause = function () {
                invokeFunctionForEach_1$1.invokeFunctionForEach(_this.animations, "pause");
            };
            /**
             * Finishes all animations in the group
             */
            this.finish = function () {
                invokeFunctionForEach_1$1.invokeFunctionForEach(_this.animations, "finish");
            };
            /**
             * Cancels all animations in the group
             */
            this.cancel = function () {
                invokeFunctionForEach_1$1.invokeFunctionForEach(_this.animations, "cancel");
            };
            this.animations = animations;
        }
        Object.defineProperty(AnimateGroup.prototype, "onFinish", {
            /**
             * The onFinish callback.
             */
            get: function () {
                return this._onFinish;
            },
            set: function (callback) {
                var _this = this;
                this._onFinish = callback;
                var longestRunning = this.getLongestAnimation();
                if (typeof longestRunning.onFinish === "function") {
                    var fn_1 = longestRunning.onFinish;
                    longestRunning.onFinish = function () {
                        fn_1();
                        _this._onFinish();
                    };
                }
                else {
                    longestRunning.onFinish = this._onFinish;
                }
            },
            enumerable: false,
            configurable: true
        });
        /**
         * Play the group of animations
         */
        AnimateGroup.prototype.play = function () {
            invokeFunctionForEach_1$1.invokeFunctionForEach(this.animations, "play");
        };
        /**
         * Reverses all animations in the group
         */
        AnimateGroup.prototype.reverse = function () {
            invokeFunctionForEach_1$1.invokeFunctionForEach(this.animations, "reverse");
        };
        /**
         * Returns the longest running animation in the group
         */
        AnimateGroup.prototype.getLongestAnimation = function () {
            var _this = this;
            return this.animations.reduce(function (previousValue, currentValue) {
                var previousDuration = _this.getAnimationDuration(previousValue.effectTiming);
                var currentDuration = _this.getAnimationDuration(currentValue.effectTiming);
                // If two durations in the group are equal, consider the higher index the
                // longest animation - this helps ensure the group onFinish callback
                // is fired after all individual animation onFinish callbacks have fired.
                return currentDuration >= previousDuration ? currentValue : previousValue;
            });
        };
        /**
         * Returns the cumulative time it will take to complete an animation
         */
        AnimateGroup.prototype.getAnimationDuration = function (effectTiming) {
            var duration = effectTiming.duration;
            var sanitizedDuration = typeof duration === "string" ? parseFloat(duration) : duration;
            return (effectTiming.delay || 0) + (sanitizedDuration || 0);
        };
        return AnimateGroup;
    }());
    animateGroup.default = AnimateGroup;

    var animateSequence = {};

    Object.defineProperty(animateSequence, "__esModule", { value: true });
    var invokeFunctionForEach_1 = invokeFunctionForEach$1;
    /**
     * Animate a collection of {@link @microsoft/fast-animation#AnimateTo} and {@link @microsoft/fast-animation#AnimateFrom} in sequence.
     * @public
     */
    var AnimateSequence = /** @class */ (function () {
        function AnimateSequence(animations) {
            var _this = this;
            /**
             * Play the sequence of animations
             */
            this.play = function () {
                _this.applySequencedCallback(_this.animations, "play");
            };
            /**
             * Play the sequence in reverse
             */
            this.reverse = function () {
                _this.applySequencedCallback(_this.animations.reverse(), "reverse");
            };
            /**
             * Pauses all animations in the sequence
             */
            this.pause = function () {
                invokeFunctionForEach_1.invokeFunctionForEach(_this.animations, "pause");
            };
            /**
             * Finishes all animations in the sequence
             */
            this.finish = function () {
                invokeFunctionForEach_1.invokeFunctionForEach(_this.animations, "finish");
            };
            /**
             * Cancels all animations in the sequence
             */
            this.cancel = function () {
                invokeFunctionForEach_1.invokeFunctionForEach(_this.animations, "cancel");
            };
            this.animations = animations;
        }
        /**
         * Sequences a set of animations and calls the specified method
         */
        AnimateSequence.prototype.applySequencedCallback = function (animations, method) {
            var _this = this;
            var animationCount = animations.length;
            if (animationCount <= 0) {
                return;
            }
            animations.forEach(function (animation, index) {
                // If this is not the last animation, format animation sequence chain
                if (index < animationCount - 1) {
                    animation.onFinish = _this.animations[index + 1][method];
                }
                else {
                    // Else attach onFinish or nullify any existing onFinish on the animation
                    animation.onFinish = _this.onFinish || void 0;
                }
            });
            animations[0][method]();
        };
        return AnimateSequence;
    }());
    animateSequence.default = AnimateSequence;

    var fade = {};

    (function (exports) {
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.fadeOut = exports.fadeIn = exports.applyFade = exports.fadeEffectTiming = exports.fadeOutKeyframes = exports.fadeInKeyframes = void 0;
    var animateTo_1 = animateTo;
    /**
     * Key frame object for fade-in animations
     */
    exports.fadeInKeyframes = [
        { opacity: "0.01" },
        { opacity: "1" },
    ];
    /**
     * Key frame object for fade-out animations
     */
    exports.fadeOutKeyframes = [
        { opacity: "1" },
        { opacity: "0" },
    ];
    /**
     * EffectTiming defaults for fade animations
     */
    exports.fadeEffectTiming = {
        easing: "linear",
        duration: 500,
    };
    function applyFade(element, keyframes, timing) {
        if (timing === void 0) { timing = {}; }
        var fadeAnimationTiming = Object.assign({}, exports.fadeEffectTiming, timing);
        var fadeAnimation = new animateTo_1.default(element, null, fadeAnimationTiming);
        fadeAnimation.addKeyframes(keyframes);
        return fadeAnimation;
    }
    exports.applyFade = applyFade;
    /**
     * Creates an animation to fade an element into view
     *
     * @public
     */
    function fadeIn(element, effectTiming) {
        if (effectTiming === void 0) { effectTiming = {}; }
        return applyFade(element, exports.fadeInKeyframes, effectTiming);
    }
    exports.fadeIn = fadeIn;
    /**
     * Creates an animation to fade an element out of view
     *
     * @public
     */
    function fadeOut(element, effectTiming) {
        if (effectTiming === void 0) { effectTiming = {}; }
        return applyFade(element, exports.fadeOutKeyframes, effectTiming);
    }
    exports.fadeOut = fadeOut;
    }(fade));

    var curves = {};

    var config = {};

    Object.defineProperty(config, "__esModule", { value: true });
    config.navPane = config.exponentialReversed = config.fastInFortySevenPercent = config.exponential = config.fastInOut = config.fastOut = config.fastIn = config.appToApp = config.backToApp = config.drillIn = config.easeIn = config.easeOutSmooth = config.easeOut = config.linear = void 0;
    config.linear = [
        [0, 0],
        [1, 1],
    ];
    config.easeOut = [
        [0, 0],
        [0.58, 1],
    ];
    config.easeOutSmooth = [
        [0, 0.35],
        [0.15, 1],
    ];
    config.easeIn = [
        [0.25, 0.1],
        [0.25, 1],
    ];
    config.drillIn = [
        [0.17, 0.17],
        [0, 1],
    ];
    config.backToApp = [
        [0.5, 0],
        [0.6, 1],
    ];
    config.appToApp = [
        [0.5, 0],
        [1, 0.9],
    ];
    config.fastIn = [
        [0.1, 0.9],
        [0.2, 1],
    ];
    config.fastOut = [
        [0.9, 0.1],
        [1, 0.2],
    ];
    config.fastInOut = [
        [0.8, 0],
        [0.2, 1],
    ];
    config.exponential = [
        [0.1, 0.25],
        [0.75, 0.9],
    ];
    config.fastInFortySevenPercent = [
        [0.11, 0.5],
        [0.24, 0.96],
    ];
    config.exponentialReversed = [
        [0.25, 0.1],
        [0.9, 0.75],
    ];
    config.navPane = [
        [0.1, 0.7],
        [0.1, 1],
    ];

    Object.defineProperty(curves, "__esModule", { value: true });
    curves.cubicBezier = curves.formatCubicBezier = void 0;
    var bezierCurves = config;
    /**
     * Formats a cubic bezier config into a cubic bezier string
     *
     * @public
     */
    function formatCubicBezier(points) {
        if (!Array.isArray(points) ||
            !Array.isArray(points[0]) ||
            !Array.isArray(points[1])) {
            return "";
        }
        var p0 = points[0];
        var p1 = points[1];
        return "cubic-bezier(" + p0[0] + ", " + p0[1] + ", " + p1[0] + ", " + p1[1] + ")";
    }
    curves.formatCubicBezier = formatCubicBezier;
    /**
     * Get a cubic bezier curve, formatted as a string, by name.
     * @param name - the name of the bezier curve to use.
     *
     * @public
     */
    function cubicBezier(name) {
        return name in bezierCurves ? formatCubicBezier(bezierCurves[name]) : "";
    }
    curves.cubicBezier = cubicBezier;

    var ScrollTrigger$2 = {};

    var isElementInView$1 = {};

    Object.defineProperty(isElementInView$1, "__esModule", { value: true });
    /**
     * Checks to see if any part of an element is within the viewport
     */
    function isElementInView(el) {
        var rect = el.getBoundingClientRect();
        return (rect.bottom >= 0 &&
            rect.right >= 0 &&
            rect.top <= window.innerHeight &&
            rect.left <= window.innerWidth);
    }
    isElementInView$1.default = isElementInView;

    var ScrollBase = {};

    var scrollY$1 = {};

    Object.defineProperty(scrollY$1, "__esModule", { value: true });
    /**
     * Gets the document's scrollY
     */
    function scrollY() {
        if (typeof window === "undefined") {
            return NaN;
        }
        return typeof window.scrollY !== "undefined" ? window.scrollY : window.pageYOffset;
    }
    scrollY$1.default = scrollY;

    Object.defineProperty(ScrollBase, "__esModule", { value: true });
    var isElementInView_1$3 = isElementInView$1;
    var scrollY_1 = scrollY$1;
    /**
     * Scroll trigger base-class that handles event binding and element/callback registration.
     */
    var ScrollTrigger$1 = /** @class */ (function () {
        function ScrollTrigger() {
            var _this = this;
            this.subscriptions = [];
            this.scrollDistance = 0;
            /**
             * Request's an animation frame if there are currently no open animation frame requests
             */
            this.requestFrame = function () {
                if (_this.requestedFrame) {
                    cancelAnimationFrame(_this.requestedFrame);
                }
                _this.requestedFrame = requestAnimationFrame(_this.update);
            };
            this.lastScrollY = scrollY_1.default();
            // We need to use .bind instead of lambda (fat-arrow) syntax here because
            // protected methods declared as lambda functions cannot be invoked by
            // extending classes via the `super` object
            this.update = this.update.bind(this);
        }
        /**
         * Subscribe an element and callback for scroll triggers
         */
        ScrollTrigger.prototype.subscribe = function (element, callback) {
            if (!(element instanceof HTMLElement) ||
                typeof callback !== "function" ||
                this.isSubscribed(element, callback)) {
                return;
            }
            if (this.subscriptions.length === 0) {
                window.addEventListener("scroll", this.requestFrame);
            }
            this.subscriptions.push({
                element: element,
                callback: callback,
                inView: isElementInView_1$3.default(element),
            });
        };
        /**
         * Unsubscribe an element and callback for scroll triggers
         */
        ScrollTrigger.prototype.unsubscribe = function (element, callback) {
            this.subscriptions = this.subscriptions.filter(function (subscription) {
                return !(element === subscription.element && callback === subscription.callback);
            });
            if (this.subscriptions.length === 0) {
                window.removeEventListener("scroll", this.requestFrame);
            }
        };
        /**
         * Make any arbitrary updates to UI
         */
        ScrollTrigger.prototype.update = function () {
            var yOffset = scrollY_1.default();
            this.scrollDistance = yOffset - this.lastScrollY;
            this.lastScrollY = yOffset;
        };
        /**
         * Checks to see if element/callback pairs have been registered so we don't duplicate registration.
         */
        ScrollTrigger.prototype.isSubscribed = function (element, callback) {
            return !!this.subscriptions.filter(function (subscription) {
                return (element === subscription.element && callback === subscription.callback);
            }).length;
        };
        return ScrollTrigger;
    }());
    ScrollBase.default = ScrollTrigger$1;

    var __extends$2 = (commonjsGlobal && commonjsGlobal.__extends) || (function () {
        var extendStatics = function (d, b) {
            extendStatics = Object.setPrototypeOf ||
                ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
                function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
            return extendStatics(d, b);
        };
        return function (d, b) {
            extendStatics(d, b);
            function __() { this.constructor = d; }
            d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
        };
    })();
    Object.defineProperty(ScrollTrigger$2, "__esModule", { value: true });
    var isElementInView_1$2 = isElementInView$1;
    var ScrollBase_1$2 = ScrollBase;
    /**
     * Utility for registering element/callback pairs where the callback will be called on scroll while the element is in view.
     *
     * @public
     */
    var ScrollTrigger = /** @class */ (function (_super) {
        __extends$2(ScrollTrigger, _super);
        function ScrollTrigger() {
            return _super !== null && _super.apply(this, arguments) || this;
        }
        /**
         * Check if elements are in view-port and apply scroll method if they are
         */
        ScrollTrigger.prototype.update = function () {
            var _this = this;
            _super.prototype.update.call(this);
            this.subscriptions.forEach(function (subscription) {
                var inView = isElementInView_1$2.default(subscription.element);
                if (inView) {
                    subscription.callback(_this.scrollDistance);
                }
                if (inView !== subscription.inView) {
                    subscription.inView = inView;
                }
            });
        };
        return ScrollTrigger;
    }(ScrollBase_1$2.default));
    ScrollTrigger$2.default = ScrollTrigger;

    var ViewEnterTrigger$1 = {};

    var __extends$1 = (commonjsGlobal && commonjsGlobal.__extends) || (function () {
        var extendStatics = function (d, b) {
            extendStatics = Object.setPrototypeOf ||
                ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
                function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
            return extendStatics(d, b);
        };
        return function (d, b) {
            extendStatics(d, b);
            function __() { this.constructor = d; }
            d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
        };
    })();
    Object.defineProperty(ViewEnterTrigger$1, "__esModule", { value: true });
    var isElementInView_1$1 = isElementInView$1;
    var ScrollBase_1$1 = ScrollBase;
    /**
     * Utility for registering element/callback pairs where the callback will be called when the element enters the view-port
     *
     * @public
     */
    var ViewEnterTrigger = /** @class */ (function (_super) {
        __extends$1(ViewEnterTrigger, _super);
        function ViewEnterTrigger() {
            return _super !== null && _super.apply(this, arguments) || this;
        }
        /**
         * Check if elements are in view-port and apply scroll method if they are
         */
        ViewEnterTrigger.prototype.update = function () {
            var _this = this;
            _super.prototype.update.call(this);
            this.subscriptions.forEach(
            /* eslint-disable-next-line */
            function (subscription, index) {
                var inView = isElementInView_1$1.default(subscription.element);
                // If the element is in view but previously wasn't
                if (inView && !subscription.inView) {
                    subscription.callback(_this.scrollDistance);
                }
                if (inView !== subscription.inView) {
                    subscription.inView = inView;
                }
            });
        };
        return ViewEnterTrigger;
    }(ScrollBase_1$1.default));
    ViewEnterTrigger$1.default = ViewEnterTrigger;

    var ViewExitTrigger$1 = {};

    var __extends = (commonjsGlobal && commonjsGlobal.__extends) || (function () {
        var extendStatics = function (d, b) {
            extendStatics = Object.setPrototypeOf ||
                ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
                function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
            return extendStatics(d, b);
        };
        return function (d, b) {
            extendStatics(d, b);
            function __() { this.constructor = d; }
            d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
        };
    })();
    Object.defineProperty(ViewExitTrigger$1, "__esModule", { value: true });
    var isElementInView_1 = isElementInView$1;
    var ScrollBase_1 = ScrollBase;
    /**
     * Utility for registering element/callback pairs where the callback will be invoked when the element exits the view-port
     *
     * @public
     */
    var ViewExitTrigger = /** @class */ (function (_super) {
        __extends(ViewExitTrigger, _super);
        function ViewExitTrigger() {
            return _super !== null && _super.apply(this, arguments) || this;
        }
        /**
         * Check if elements are in view-port and apply scroll method if they are
         */
        ViewExitTrigger.prototype.update = function () {
            var _this = this;
            _super.prototype.update.call(this);
            this.subscriptions.forEach(
            /* eslint-disable-next-line */
            function (subscription, index) {
                var inView = isElementInView_1.default(subscription.element);
                // If the element is out of view but previously was in view
                if (!inView && subscription.inView) {
                    subscription.callback(_this.scrollDistance);
                }
                if (inView !== subscription.inView) {
                    subscription.inView = inView;
                }
            });
        };
        return ViewExitTrigger;
    }(ScrollBase_1.default));
    ViewExitTrigger$1.default = ViewExitTrigger;

    (function (exports) {
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ViewExitTrigger = exports.ViewEnterTrigger = exports.ScrollTrigger = exports.fadeOut = exports.fadeIn = exports.cubicBezier = exports.AnimateTo = exports.AnimateSequence = exports.AnimateGroup = exports.AnimateFrom = exports.Animate = void 0;
    var animateTo_1 = animateTo;
    exports.AnimateTo = animateTo_1.default;
    var animateFrom_1 = animateFrom;
    exports.AnimateFrom = animateFrom_1.default;
    var animateGroup_1 = animateGroup;
    exports.AnimateGroup = animateGroup_1.default;
    var animateSequence_1 = animateSequence;
    exports.AnimateSequence = animateSequence_1.default;
    var animate_1 = animate;
    exports.Animate = animate_1.default;
    var fade_1 = fade;
    Object.defineProperty(exports, "fadeIn", { enumerable: true, get: function () { return fade_1.fadeIn; } });
    Object.defineProperty(exports, "fadeOut", { enumerable: true, get: function () { return fade_1.fadeOut; } });
    var curves_1 = curves;
    Object.defineProperty(exports, "cubicBezier", { enumerable: true, get: function () { return curves_1.cubicBezier; } });
    var ScrollTrigger_1 = ScrollTrigger$2;
    exports.ScrollTrigger = ScrollTrigger_1.default;
    var ViewEnterTrigger_1 = ViewEnterTrigger$1;
    exports.ViewEnterTrigger = ViewEnterTrigger_1.default;
    var ViewExitTrigger_1 = ViewExitTrigger$1;
    exports.ViewExitTrigger = ViewExitTrigger_1.default;
    }(dist));

    /**
     * Singleton utility to watch the prefers-reduced-motion media value
     */
    const prefersReducedMotionMediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    const slideLeftKeyframes = [
        {
            transform: 'translateX(-100%)',
            visibility: 'hidden',
            offset: 0
        },
        {
            transform: 'translateX(-100%)',
            visibility: 'visible',
            offset: 0.01
        },
        {
            transform: 'translateX(0%)',
            visibility: 'visible',
            offset: 1
        }
    ];
    const slideRightKeyframes = [
        {
            transform: 'translateX(100%)',
            visibility: 'hidden',
            offset: 0
        },
        {
            transform: 'translateX(100%)',
            visibility: 'visible',
            offset: 0.01
        },
        {
            transform: 'translateX(0%)',
            visibility: 'visible',
            offset: 1
        }
    ];
    const fadeOverlayKeyframes = [{ opacity: 0 }, { opacity: 1 }];
    const slideInOptions = {
        duration: 1,
        easing: 'ease-out'
    };
    const slideOutOptions = {
        duration: 1,
        easing: 'ease-in',
        direction: 'reverse'
    };
    const animationConfig = {
        slideLeftKeyframes,
        slideRightKeyframes,
        fadeOverlayKeyframes,
        slideInOptions,
        slideOutOptions
    };

    const styles$g = css `
    ${display('block')}

    :host {
        position: relative;
        top: 0;
        bottom: 0;
        width: fit-content;
        height: 100%;
        outline: none;
        font: ${bodyFont};
        color: ${bodyFontColor};
    }

    :host([modal]) {
        position: absolute;
    }

    :host([location='left']) {
        left: 0px;
    }

    :host([location='right']) {
        right: 0px;
    }

    .positioning-region {
        display: block;
        position: relative;
        justify-content: center;
        width: fit-content;
        height: 100%;
        inset: 0px;
        overflow: hidden;
        z-index: 999;
    }

    :host([modal]) .positioning-region {
        width: 100%;
        position: fixed;
        display: flex;
    }

    ${ /* Note: overlay is only present in the DOM when modal=true */''}
    .overlay {
        position: fixed;
        inset: 0px;
        background: ${popupBorderColor};
        touch-action: none;
    }

    .control {
        position: relative;
        top: 0px;
        bottom: 0px;
        display: grid;
        grid-template-rows: max-content auto max-content;
        flex-direction: column;
        box-sizing: border-box;
        border-radius: 0px;
        border-width: 0px;
        width: ${drawerWidth};
        height: 100%;
        background-color: ${applicationBackgroundColor};
    }

    :host([modal]) .control {
        position: absolute;
        height: 100%;
    }

    :host(.hidden) .control {
        visibility: hidden;
    }

    :host([location='left']) .control {
        left: 0px;
        border-right: ${borderWidth} solid ${popupBoxShadowColor};
    }

    :host([location='right']) .control {
        right: 0px;
        border-left: ${borderWidth} solid ${popupBoxShadowColor};
    }

    ${
/*
    Styling for a 3-panel drawer with header, footer, and a content
    region filling the remaining space/height
*/ ''}

    ::slotted(header) {
        padding: ${standardPadding};
        font: ${titlePlus1Font};
    }

    ::slotted(section) {
        padding: ${standardPadding};
        grid-row: 2;
        overflow-y: auto;
    }

    ::slotted(footer) {
        padding: ${standardPadding};
        display: flex;
        justify-content: flex-end;
        grid-row: 3;
        border-top: ${borderWidth} solid ${popupBorderColor};
    }
`;

    var DrawerLocation;
    (function (DrawerLocation) {
        DrawerLocation["Left"] = "left";
        DrawerLocation["Right"] = "right";
    })(DrawerLocation || (DrawerLocation = {}));
    var DrawerState;
    (function (DrawerState) {
        DrawerState["Opening"] = "opening";
        DrawerState["Opened"] = "opened";
        DrawerState["Closing"] = "closing";
        DrawerState["Closed"] = "closed";
    })(DrawerState || (DrawerState = {}));

    const animationDurationWhenDisabledMilliseconds = 0.001;
    /**
     * Drawer/Sidenav control. Shows content in a panel on the left / right side of the screen,
     * which animates to be visible with a slide-in / slide-out animation.
     * Configured via 'location', 'state', 'modal', 'preventDismiss' properties.
     */
    class Drawer extends Dialog {
        constructor() {
            super(...arguments);
            this.location = DrawerLocation.Left;
            this.state = DrawerState.Closed;
            /**
             * True to prevent dismissing the drawer when the overlay outside the drawer is clicked.
             * Only applicable when 'modal' is set to true (i.e. when the overlay is used).
             * HTML Attribute: prevent-dismiss
             */
            this.preventDismiss = false;
            this.propertiesToWatch = ['hidden', 'location', 'state'];
            this.animationDurationMilliseconds = animationDurationWhenDisabledMilliseconds;
        }
        connectedCallback() {
            // disable trapFocus before super.connectedCallback as FAST Dialog will immediately queue work to
            // change focus if it's true before connectedCallback
            this.trapFocus = false;
            super.connectedCallback();
            this.updateAnimationDuration();
            this.animationsEnabledChangedHandler = () => this.updateAnimationDuration();
            prefersReducedMotionMediaQuery.addEventListener('change', this.animationsEnabledChangedHandler);
            this.onStateChanged();
            const notifier = Observable.getNotifier(this);
            const subscriber = {
                handleChange: (_source, propertyName) => this.onPropertyChange(propertyName)
            };
            this.propertiesToWatch.forEach(propertyName => notifier.subscribe(subscriber, propertyName));
            this.propertyChangeSubscriber = subscriber;
            this.propertyChangeNotifier = notifier;
        }
        disconnectedCallback() {
            super.disconnectedCallback();
            this.cancelCurrentAnimation();
            if (this.propertyChangeNotifier && this.propertyChangeSubscriber) {
                this.propertiesToWatch.forEach(propertyName => this.propertyChangeNotifier.unsubscribe(this.propertyChangeSubscriber, propertyName));
                this.propertyChangeNotifier = undefined;
                this.propertyChangeSubscriber = undefined;
            }
            if (this.animationsEnabledChangedHandler) {
                prefersReducedMotionMediaQuery.removeEventListener('change', this.animationsEnabledChangedHandler);
                this.animationsEnabledChangedHandler = undefined;
            }
        }
        show() {
            // Not calling super.show() as that will immediately show the drawer, whereas 'Opening' state will animate
            this.state = DrawerState.Opening;
        }
        hide() {
            // Not calling super.hide() as that will immediately hide the drawer, whereas 'Closing' state will animate
            this.state = DrawerState.Closing;
        }
        dismiss() {
            if (!this.preventDismiss) {
                super.dismiss();
                this.hide();
            }
        }
        onPropertyChange(propertyName) {
            switch (propertyName) {
                case 'hidden':
                    this.onHiddenChanged();
                    break;
                case 'location':
                    this.onLocationChanged();
                    break;
                case 'state':
                    this.onStateChanged();
                    break;
            }
        }
        onHiddenChanged() {
            if (this.hidden && this.state !== DrawerState.Closed) {
                this.state = DrawerState.Closed;
            }
            else if (!this.hidden && this.state === DrawerState.Closed) {
                this.state = DrawerState.Opened;
            }
        }
        onLocationChanged() {
            this.cancelCurrentAnimation();
        }
        onStateChanged() {
            if (this.isConnected) {
                this.cancelCurrentAnimation();
                switch (this.state) {
                    case DrawerState.Opening:
                        this.animateOpening();
                        this.hidden = false;
                        break;
                    case DrawerState.Opened:
                        this.hidden = false;
                        break;
                    case DrawerState.Closing:
                        this.hidden = false;
                        this.animateClosing();
                        break;
                    case DrawerState.Closed:
                        this.hidden = true;
                        break;
                    default:
                        throw new Error('Unsupported state value. Expected: opening/opened/closing/closed');
                }
                this.$emit('state-change');
            }
        }
        updateAnimationDuration() {
            const disableAnimations = prefersReducedMotionMediaQuery.matches;
            this.animationDurationMilliseconds = disableAnimations
                ? animationDurationWhenDisabledMilliseconds
                : largeDelay.getValueFor(this);
        }
        animateOpening() {
            this.animateOpenClose(true);
        }
        animateClosing() {
            if (!this.hidden) {
                this.animateOpenClose(false);
            }
            else {
                this.state = DrawerState.Closed;
            }
        }
        animateOpenClose(drawerOpening) {
            const options = {
                ...(drawerOpening
                    ? animationConfig.slideInOptions
                    : animationConfig.slideOutOptions),
                duration: this.animationDurationMilliseconds
            };
            const drawerKeyframes = this.location === DrawerLocation.Right
                ? animationConfig.slideRightKeyframes
                : animationConfig.slideLeftKeyframes;
            const dialogAnimation = new dist.AnimateTo(this.dialog, undefined, options);
            dialogAnimation.addKeyframes(drawerKeyframes);
            const animations = [dialogAnimation];
            const overlay = this.shadowRoot.querySelector('.overlay');
            if (overlay) {
                const overlayAnimation = new dist.AnimateTo(overlay, undefined, options);
                overlayAnimation.addKeyframes(animationConfig.fadeOverlayKeyframes);
                animations.push(overlayAnimation);
            }
            const animationGroup = new dist.AnimateGroup(animations);
            animationGroup.onFinish = () => {
                this.state = drawerOpening
                    ? DrawerState.Opened
                    : DrawerState.Closed;
            };
            this.animationGroup = animationGroup;
            animationGroup.play();
        }
        cancelCurrentAnimation() {
            this.animationGroup.cancel();
        }
    }
    __decorate([
        attr
    ], Drawer.prototype, "location", void 0);
    __decorate([
        attr
    ], Drawer.prototype, "state", void 0);
    __decorate([
        attr({ attribute: 'prevent-dismiss', mode: 'boolean' })
    ], Drawer.prototype, "preventDismiss", void 0);
    const nimbleDrawer = Drawer.compose({
        baseName: 'drawer',
        template: dialogTemplate,
        styles: styles$g
    });
    DesignSystem.getOrCreate().withPrefix('nimble').register(nimbleDrawer());

    const template$3 = html `
    <template>
        <div class="icon" :innerHTML=${x => x.icon.data}></div>
    </template
`;

    const styles$f = css `
    ${display('inline-flex')}

    :host {
        align-items: center;
        user-select: none;
        width: ${iconSize};
        height: ${iconSize};
    }

    .icon {
        width: 100%;
        height: 100%;
    }

    :host(.fail) {
        ${iconColor.cssCustomProperty}: ${failColor};
    }

    :host(.warning) {
        ${iconColor.cssCustomProperty}: ${warningColor};
    }

    :host(.pass) {
        ${iconColor.cssCustomProperty}: ${passColor};
    }

    .icon svg {
        fill: ${iconColor};
        width: 100%;
        height: 100%;
    }
`;

    /**
     * The base class for icon components
     */
    class Icon extends FoundationElement {
        constructor(icon) {
            super();
            this.icon = icon;
        }
    }
    const registerIcon = (baseName, iconClass) => {
        const composedIcon = iconClass.compose({
            baseName,
            template: template$3,
            styles: styles$f,
            baseClass: iconClass
        });
        DesignSystem.getOrCreate().withPrefix('nimble').register(composedIcon());
    };

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'add' icon
     */
    class AddIcon extends Icon {
        constructor() {
            super(add16X16);
        }
    }
    registerIcon('add-icon', AddIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'arrowDownRightAndArrowUpLeft' icon
     */
    class ArrowDownRightAndArrowUpLeftIcon extends Icon {
        constructor() {
            super(arrowDownRightAndArrowUpLeft16X16);
        }
    }
    registerIcon('arrow-down-right-and-arrow-up-left-icon', ArrowDownRightAndArrowUpLeftIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'arrowExpanderDown' icon
     */
    class ArrowExpanderDownIcon extends Icon {
        constructor() {
            super(arrowExpanderDown16X16);
        }
    }
    registerIcon('arrow-expander-down-icon', ArrowExpanderDownIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'arrowExpanderLeft' icon
     */
    class ArrowExpanderLeftIcon extends Icon {
        constructor() {
            super(arrowExpanderLeft16X16);
        }
    }
    registerIcon('arrow-expander-left-icon', ArrowExpanderLeftIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'arrowExpanderRight' icon
     */
    class ArrowExpanderRightIcon extends Icon {
        constructor() {
            super(arrowExpanderRight16X16);
        }
    }
    registerIcon('arrow-expander-right-icon', ArrowExpanderRightIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'arrowExpanderUp' icon
     */
    class ArrowExpanderUpIcon extends Icon {
        constructor() {
            super(arrowExpanderUp16X16);
        }
    }
    registerIcon('arrow-expander-up-icon', ArrowExpanderUpIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'arrowLeftFromLine' icon
     */
    class ArrowLeftFromLineIcon extends Icon {
        constructor() {
            super(arrowLeftFromLine16X16);
        }
    }
    registerIcon('arrow-left-from-line-icon', ArrowLeftFromLineIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'arrowPartialRotateLeft' icon
     */
    class ArrowPartialRotateLeftIcon extends Icon {
        constructor() {
            super(arrowPartialRotateLeft16X16);
        }
    }
    registerIcon('arrow-partial-rotate-left-icon', ArrowPartialRotateLeftIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'arrowRightToLine' icon
     */
    class ArrowRightToLineIcon extends Icon {
        constructor() {
            super(arrowRightToLine16X16);
        }
    }
    registerIcon('arrow-right-to-line-icon', ArrowRightToLineIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'arrowRotateRight' icon
     */
    class ArrowRotateRightIcon extends Icon {
        constructor() {
            super(arrowRotateRight16X16);
        }
    }
    registerIcon('arrow-rotate-right-icon', ArrowRotateRightIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'arrowURotateLeft' icon
     */
    class ArrowURotateLeftIcon extends Icon {
        constructor() {
            super(arrowURotateLeft16X16);
        }
    }
    registerIcon('arrow-u-rotate-left-icon', ArrowURotateLeftIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'arrowUpLeftAndArrowDownRight' icon
     */
    class ArrowUpLeftAndArrowDownRightIcon extends Icon {
        constructor() {
            super(arrowUpLeftAndArrowDownRight16X16);
        }
    }
    registerIcon('arrow-up-left-and-arrow-down-right-icon', ArrowUpLeftAndArrowDownRightIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'arrowsMaximize' icon
     */
    class ArrowsMaximizeIcon extends Icon {
        constructor() {
            super(arrowsMaximize16X16);
        }
    }
    registerIcon('arrows-maximize-icon', ArrowsMaximizeIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'arrowsRepeat' icon
     */
    class ArrowsRepeatIcon extends Icon {
        constructor() {
            super(arrowsRepeat16X16);
        }
    }
    registerIcon('arrows-repeat-icon', ArrowsRepeatIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'bars' icon
     */
    class BarsIcon extends Icon {
        constructor() {
            super(bars16X16);
        }
    }
    registerIcon('bars-icon', BarsIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'bell' icon
     */
    class BellIcon extends Icon {
        constructor() {
            super(bell16X16);
        }
    }
    registerIcon('bell-icon', BellIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'bellAndComment' icon
     */
    class BellAndCommentIcon extends Icon {
        constructor() {
            super(bellAndComment16X16);
        }
    }
    registerIcon('bell-and-comment-icon', BellAndCommentIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'bellCircle' icon
     */
    class BellCircleIcon extends Icon {
        constructor() {
            super(bellCircle16X16);
        }
    }
    registerIcon('bell-circle-icon', BellCircleIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'bellSolidCircle' icon
     */
    class BellSolidCircleIcon extends Icon {
        constructor() {
            super(bellSolidCircle16X16);
        }
    }
    registerIcon('bell-solid-circle-icon', BellSolidCircleIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'blockWithRibbon' icon
     */
    class BlockWithRibbonIcon extends Icon {
        constructor() {
            super(blockWithRibbon16X16);
        }
    }
    registerIcon('block-with-ribbon-icon', BlockWithRibbonIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'calendar' icon
     */
    class CalendarIcon extends Icon {
        constructor() {
            super(calendar16X16);
        }
    }
    registerIcon('calendar-icon', CalendarIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'chartDiagram' icon
     */
    class ChartDiagramIcon extends Icon {
        constructor() {
            super(chartDiagram16X16);
        }
    }
    registerIcon('chart-diagram-icon', ChartDiagramIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'chartDiagramChildFocus' icon
     */
    class ChartDiagramChildFocusIcon extends Icon {
        constructor() {
            super(chartDiagramChildFocus16X16);
        }
    }
    registerIcon('chart-diagram-child-focus-icon', ChartDiagramChildFocusIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'chartDiagramParentFocus' icon
     */
    class ChartDiagramParentFocusIcon extends Icon {
        constructor() {
            super(chartDiagramParentFocus16X16);
        }
    }
    registerIcon('chart-diagram-parent-focus-icon', ChartDiagramParentFocusIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'chartDiagramParentFocusTwoChild' icon
     */
    class ChartDiagramParentFocusTwoChildIcon extends Icon {
        constructor() {
            super(chartDiagramParentFocusTwoChild16X16);
        }
    }
    registerIcon('chart-diagram-parent-focus-two-child-icon', ChartDiagramParentFocusTwoChildIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'check' icon
     */
    class CheckIcon extends Icon {
        constructor() {
            super(check16X16);
        }
    }
    registerIcon('check-icon', CheckIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'checkDot' icon
     */
    class CheckDotIcon extends Icon {
        constructor() {
            super(checkDot16X16);
        }
    }
    registerIcon('check-dot-icon', CheckDotIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'circle' icon
     */
    class CircleIcon extends Icon {
        constructor() {
            super(circle16X16);
        }
    }
    registerIcon('circle-icon', CircleIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'circleBroken' icon
     */
    class CircleBrokenIcon extends Icon {
        constructor() {
            super(circleBroken16X16);
        }
    }
    registerIcon('circle-broken-icon', CircleBrokenIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'circleCheck' icon
     */
    class CircleCheckIcon extends Icon {
        constructor() {
            super(circleCheck16X16);
        }
    }
    registerIcon('circle-check-icon', CircleCheckIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'circlePartialBroken' icon
     */
    class CirclePartialBrokenIcon extends Icon {
        constructor() {
            super(circlePartialBroken16X16);
        }
    }
    registerIcon('circle-partial-broken-icon', CirclePartialBrokenIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'circleSlash' icon
     */
    class CircleSlashIcon extends Icon {
        constructor() {
            super(circleSlash16X16);
        }
    }
    registerIcon('circle-slash-icon', CircleSlashIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'circleX' icon
     */
    class CircleXIcon extends Icon {
        constructor() {
            super(circleX16X16);
        }
    }
    registerIcon('circle-x-icon', CircleXIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'clipboard' icon
     */
    class ClipboardIcon extends Icon {
        constructor() {
            super(clipboard16X16);
        }
    }
    registerIcon('clipboard-icon', ClipboardIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'clock' icon
     */
    class ClockIcon extends Icon {
        constructor() {
            super(clock16X16);
        }
    }
    registerIcon('clock-icon', ClockIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'clockCog' icon
     */
    class ClockCogIcon extends Icon {
        constructor() {
            super(clockCog16X16);
        }
    }
    registerIcon('clock-cog-icon', ClockCogIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'clockTriangle' icon
     */
    class ClockTriangleIcon extends Icon {
        constructor() {
            super(clockTriangle16X16);
        }
    }
    registerIcon('clock-triangle-icon', ClockTriangleIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'clone' icon
     */
    class CloneIcon extends Icon {
        constructor() {
            super(clone16X16);
        }
    }
    registerIcon('clone-icon', CloneIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'cloudUpload' icon
     */
    class CloudUploadIcon extends Icon {
        constructor() {
            super(cloudUpload16X16);
        }
    }
    registerIcon('cloud-upload-icon', CloudUploadIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'cloudWithArrow' icon
     */
    class CloudWithArrowIcon extends Icon {
        constructor() {
            super(cloudWithArrow16X16);
        }
    }
    registerIcon('cloud-with-arrow-icon', CloudWithArrowIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'cog' icon
     */
    class CogIcon extends Icon {
        constructor() {
            super(cog16X16);
        }
    }
    registerIcon('cog-icon', CogIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'cogDatabase' icon
     */
    class CogDatabaseIcon extends Icon {
        constructor() {
            super(cogDatabase16X16);
        }
    }
    registerIcon('cog-database-icon', CogDatabaseIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'cogDatabaseInset' icon
     */
    class CogDatabaseInsetIcon extends Icon {
        constructor() {
            super(cogDatabaseInset16X16);
        }
    }
    registerIcon('cog-database-inset-icon', CogDatabaseInsetIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'cogSmallCog' icon
     */
    class CogSmallCogIcon extends Icon {
        constructor() {
            super(cogSmallCog16X16);
        }
    }
    registerIcon('cog-small-cog-icon', CogSmallCogIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'cogZoomed' icon
     */
    class CogZoomedIcon extends Icon {
        constructor() {
            super(cogZoomed16X16);
        }
    }
    registerIcon('cog-zoomed-icon', CogZoomedIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'comment' icon
     */
    class CommentIcon extends Icon {
        constructor() {
            super(comment16X16);
        }
    }
    registerIcon('comment-icon', CommentIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'computerAndMonitor' icon
     */
    class ComputerAndMonitorIcon extends Icon {
        constructor() {
            super(computerAndMonitor16X16);
        }
    }
    registerIcon('computer-and-monitor-icon', ComputerAndMonitorIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'copy' icon
     */
    class CopyIcon extends Icon {
        constructor() {
            super(copy16X16);
        }
    }
    registerIcon('copy-icon', CopyIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'copyText' icon
     */
    class CopyTextIcon extends Icon {
        constructor() {
            super(copyText16X16);
        }
    }
    registerIcon('copy-text-icon', CopyTextIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'dashboardBuilder' icon
     */
    class DashboardBuilderIcon extends Icon {
        constructor() {
            super(dashboardBuilder16X16);
        }
    }
    registerIcon('dashboard-builder-icon', DashboardBuilderIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'dashboardBuilderLegend' icon
     */
    class DashboardBuilderLegendIcon extends Icon {
        constructor() {
            super(dashboardBuilderLegend16X16);
        }
    }
    registerIcon('dashboard-builder-legend-icon', DashboardBuilderLegendIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'dashboardBuilderTemplates' icon
     */
    class DashboardBuilderTemplatesIcon extends Icon {
        constructor() {
            super(dashboardBuilderTemplates16X16);
        }
    }
    registerIcon('dashboard-builder-templates-icon', DashboardBuilderTemplatesIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'dashboardBuilderTile' icon
     */
    class DashboardBuilderTileIcon extends Icon {
        constructor() {
            super(dashboardBuilderTile16X16);
        }
    }
    registerIcon('dashboard-builder-tile-icon', DashboardBuilderTileIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'database' icon
     */
    class DatabaseIcon extends Icon {
        constructor() {
            super(database16X16);
        }
    }
    registerIcon('database-icon', DatabaseIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'databaseCheck' icon
     */
    class DatabaseCheckIcon extends Icon {
        constructor() {
            super(databaseCheck16X16);
        }
    }
    registerIcon('database-check-icon', DatabaseCheckIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'desktop' icon
     */
    class DesktopIcon extends Icon {
        constructor() {
            super(desktop16X16);
        }
    }
    registerIcon('desktop-icon', DesktopIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'donutChart' icon
     */
    class DonutChartIcon extends Icon {
        constructor() {
            super(donutChart16X16);
        }
    }
    registerIcon('donut-chart-icon', DonutChartIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'dotSolidDotStroke' icon
     */
    class DotSolidDotStrokeIcon extends Icon {
        constructor() {
            super(dotSolidDotStroke16X16);
        }
    }
    registerIcon('dot-solid-dot-stroke-icon', DotSolidDotStrokeIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'download' icon
     */
    class DownloadIcon extends Icon {
        constructor() {
            super(download16X16);
        }
    }
    registerIcon('download-icon', DownloadIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'electronicChipZoomed' icon
     */
    class ElectronicChipZoomedIcon extends Icon {
        constructor() {
            super(electronicChipZoomed16X16);
        }
    }
    registerIcon('electronic-chip-zoomed-icon', ElectronicChipZoomedIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'exclamationMark' icon
     */
    class ExclamationMarkIcon extends Icon {
        constructor() {
            super(exclamationMark16X16);
        }
    }
    registerIcon('exclamation-mark-icon', ExclamationMarkIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'eye' icon
     */
    class EyeIcon extends Icon {
        constructor() {
            super(eye16X16);
        }
    }
    registerIcon('eye-icon', EyeIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'fancyA' icon
     */
    class FancyAIcon extends Icon {
        constructor() {
            super(fancyA16X16);
        }
    }
    registerIcon('fancy-a-icon', FancyAIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'file' icon
     */
    class FileIcon extends Icon {
        constructor() {
            super(file16X16);
        }
    }
    registerIcon('file-icon', FileIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'fileDrawer' icon
     */
    class FileDrawerIcon extends Icon {
        constructor() {
            super(fileDrawer16X16);
        }
    }
    registerIcon('file-drawer-icon', FileDrawerIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'fileSearch' icon
     */
    class FileSearchIcon extends Icon {
        constructor() {
            super(fileSearch16X16);
        }
    }
    registerIcon('file-search-icon', FileSearchIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'filter' icon
     */
    class FilterIcon extends Icon {
        constructor() {
            super(filter16X16);
        }
    }
    registerIcon('filter-icon', FilterIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'floppyDiskCheckmark' icon
     */
    class FloppyDiskCheckmarkIcon extends Icon {
        constructor() {
            super(floppyDiskCheckmark16X16);
        }
    }
    registerIcon('floppy-disk-checkmark-icon', FloppyDiskCheckmarkIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'floppyDiskStarArrowRight' icon
     */
    class FloppyDiskStarArrowRightIcon extends Icon {
        constructor() {
            super(floppyDiskStarArrowRight16X16);
        }
    }
    registerIcon('floppy-disk-star-arrow-right-icon', FloppyDiskStarArrowRightIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'floppyDiskThreeDots' icon
     */
    class FloppyDiskThreeDotsIcon extends Icon {
        constructor() {
            super(floppyDiskThreeDots16X16);
        }
    }
    registerIcon('floppy-disk-three-dots-icon', FloppyDiskThreeDotsIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'folder' icon
     */
    class FolderIcon extends Icon {
        constructor() {
            super(folder16X16);
        }
    }
    registerIcon('folder-icon', FolderIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'folderOpen' icon
     */
    class FolderOpenIcon extends Icon {
        constructor() {
            super(folderOpen16X16);
        }
    }
    registerIcon('folder-open-icon', FolderOpenIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'forwardSlash' icon
     */
    class ForwardSlashIcon extends Icon {
        constructor() {
            super(forwardSlash16X16);
        }
    }
    registerIcon('forward-slash-icon', ForwardSlashIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'fourDotsSquare' icon
     */
    class FourDotsSquareIcon extends Icon {
        constructor() {
            super(fourDotsSquare16X16);
        }
    }
    registerIcon('four-dots-square-icon', FourDotsSquareIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'function' icon
     */
    class FunctionIcon extends Icon {
        constructor() {
            super(function16X16);
        }
    }
    registerIcon('function-icon', FunctionIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'gaugeSimple' icon
     */
    class GaugeSimpleIcon extends Icon {
        constructor() {
            super(gaugeSimple16X16);
        }
    }
    registerIcon('gauge-simple-icon', GaugeSimpleIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'gridThreeByThree' icon
     */
    class GridThreeByThreeIcon extends Icon {
        constructor() {
            super(gridThreeByThree16X16);
        }
    }
    registerIcon('grid-three-by-three-icon', GridThreeByThreeIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'gridTwoByTwo' icon
     */
    class GridTwoByTwoIcon extends Icon {
        constructor() {
            super(gridTwoByTwo16X16);
        }
    }
    registerIcon('grid-two-by-two-icon', GridTwoByTwoIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'hammer' icon
     */
    class HammerIcon extends Icon {
        constructor() {
            super(hammer16X16);
        }
    }
    registerIcon('hammer-icon', HammerIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'hashtag' icon
     */
    class HashtagIcon extends Icon {
        constructor() {
            super(hashtag16X16);
        }
    }
    registerIcon('hashtag-icon', HashtagIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'home' icon
     */
    class HomeIcon extends Icon {
        constructor() {
            super(home16X16);
        }
    }
    registerIcon('home-icon', HomeIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'hourglass' icon
     */
    class HourglassIcon extends Icon {
        constructor() {
            super(hourglass16X16);
        }
    }
    registerIcon('hourglass-icon', HourglassIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'indeterminantCheckbox' icon
     */
    class IndeterminantCheckboxIcon extends Icon {
        constructor() {
            super(indeterminantCheckbox16X16);
        }
    }
    registerIcon('indeterminant-checkbox-icon', IndeterminantCheckboxIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'info' icon
     */
    class InfoIcon extends Icon {
        constructor() {
            super(info16X16);
        }
    }
    registerIcon('info-icon', InfoIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'infoCircle' icon
     */
    class InfoCircleIcon extends Icon {
        constructor() {
            super(infoCircle16X16);
        }
    }
    registerIcon('info-circle-icon', InfoCircleIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'key' icon
     */
    class KeyIcon extends Icon {
        constructor() {
            super(key16X16);
        }
    }
    registerIcon('key-icon', KeyIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'laptop' icon
     */
    class LaptopIcon extends Icon {
        constructor() {
            super(laptop16X16);
        }
    }
    registerIcon('laptop-icon', LaptopIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'layerGroup' icon
     */
    class LayerGroupIcon extends Icon {
        constructor() {
            super(layerGroup16X16);
        }
    }
    registerIcon('layer-group-icon', LayerGroupIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'lightningBolt' icon
     */
    class LightningBoltIcon extends Icon {
        constructor() {
            super(lightningBolt16X16);
        }
    }
    registerIcon('lightning-bolt-icon', LightningBoltIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'link' icon
     */
    class LinkIcon extends Icon {
        constructor() {
            super(link16X16);
        }
    }
    registerIcon('link-icon', LinkIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'linkCancel' icon
     */
    class LinkCancelIcon extends Icon {
        constructor() {
            super(linkCancel16X16);
        }
    }
    registerIcon('link-cancel-icon', LinkCancelIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'list' icon
     */
    class ListIcon extends Icon {
        constructor() {
            super(list16X16);
        }
    }
    registerIcon('list-icon', ListIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'listTree' icon
     */
    class ListTreeIcon extends Icon {
        constructor() {
            super(listTree16X16);
        }
    }
    registerIcon('list-tree-icon', ListTreeIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'listTreeDatabase' icon
     */
    class ListTreeDatabaseIcon extends Icon {
        constructor() {
            super(listTreeDatabase16X16);
        }
    }
    registerIcon('list-tree-database-icon', ListTreeDatabaseIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'lock' icon
     */
    class LockIcon extends Icon {
        constructor() {
            super(lock16X16);
        }
    }
    registerIcon('lock-icon', LockIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'magnifyingGlass' icon
     */
    class MagnifyingGlassIcon extends Icon {
        constructor() {
            super(magnifyingGlass16X16);
        }
    }
    registerIcon('magnifying-glass-icon', MagnifyingGlassIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'markdown' icon
     */
    class MarkdownIcon extends Icon {
        constructor() {
            super(markdown16X16);
        }
    }
    registerIcon('markdown-icon', MarkdownIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'minus' icon
     */
    class MinusIcon extends Icon {
        constructor() {
            super(minus16X16);
        }
    }
    registerIcon('minus-icon', MinusIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'minusWide' icon
     */
    class MinusWideIcon extends Icon {
        constructor() {
            super(minusWide16X16);
        }
    }
    registerIcon('minus-wide-icon', MinusWideIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'mobile' icon
     */
    class MobileIcon extends Icon {
        constructor() {
            super(mobile16X16);
        }
    }
    registerIcon('mobile-icon', MobileIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'notebook' icon
     */
    class NotebookIcon extends Icon {
        constructor() {
            super(notebook16X16);
        }
    }
    registerIcon('notebook-icon', NotebookIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'paste' icon
     */
    class PasteIcon extends Icon {
        constructor() {
            super(paste16X16);
        }
    }
    registerIcon('paste-icon', PasteIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'pencil' icon
     */
    class PencilIcon extends Icon {
        constructor() {
            super(pencil16X16);
        }
    }
    registerIcon('pencil-icon', PencilIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'potWithLid' icon
     */
    class PotWithLidIcon extends Icon {
        constructor() {
            super(potWithLid16X16);
        }
    }
    registerIcon('pot-with-lid-icon', PotWithLidIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'question' icon
     */
    class QuestionIcon extends Icon {
        constructor() {
            super(question16X16);
        }
    }
    registerIcon('question-icon', QuestionIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'runningArrow' icon
     */
    class RunningArrowIcon extends Icon {
        constructor() {
            super(runningArrow16X16);
        }
    }
    registerIcon('running-arrow-icon', RunningArrowIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'server' icon
     */
    class ServerIcon extends Icon {
        constructor() {
            super(server16X16);
        }
    }
    registerIcon('server-icon', ServerIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'shareSquare' icon
     */
    class ShareSquareIcon extends Icon {
        constructor() {
            super(shareSquare16X16);
        }
    }
    registerIcon('share-square-icon', ShareSquareIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'shieldCheck' icon
     */
    class ShieldCheckIcon extends Icon {
        constructor() {
            super(shieldCheck16X16);
        }
    }
    registerIcon('shield-check-icon', ShieldCheckIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'shieldXmark' icon
     */
    class ShieldXmarkIcon extends Icon {
        constructor() {
            super(shieldXmark16X16);
        }
    }
    registerIcon('shield-xmark-icon', ShieldXmarkIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'signalBars' icon
     */
    class SignalBarsIcon extends Icon {
        constructor() {
            super(signalBars16X16);
        }
    }
    registerIcon('signal-bars-icon', SignalBarsIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'sineGraph' icon
     */
    class SineGraphIcon extends Icon {
        constructor() {
            super(sineGraph16X16);
        }
    }
    registerIcon('sine-graph-icon', SineGraphIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'skipArrow' icon
     */
    class SkipArrowIcon extends Icon {
        constructor() {
            super(skipArrow16X16);
        }
    }
    registerIcon('skip-arrow-icon', SkipArrowIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'spinner' icon
     */
    class SpinnerIcon extends Icon {
        constructor() {
            super(spinner);
        }
    }
    registerIcon('spinner-icon', SpinnerIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'squareCheck' icon
     */
    class SquareCheckIcon extends Icon {
        constructor() {
            super(squareCheck16X16);
        }
    }
    registerIcon('square-check-icon', SquareCheckIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'squareT' icon
     */
    class SquareTIcon extends Icon {
        constructor() {
            super(squareT16X16);
        }
    }
    registerIcon('square-t-icon', SquareTIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 't' icon
     */
    class TIcon extends Icon {
        constructor() {
            super(t16X16);
        }
    }
    registerIcon('t-icon', TIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'tablet' icon
     */
    class TabletIcon extends Icon {
        constructor() {
            super(tablet16X16);
        }
    }
    registerIcon('tablet-icon', TabletIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'tag' icon
     */
    class TagIcon extends Icon {
        constructor() {
            super(tag16X16);
        }
    }
    registerIcon('tag-icon', TagIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'tags' icon
     */
    class TagsIcon extends Icon {
        constructor() {
            super(tags16X16);
        }
    }
    registerIcon('tags-icon', TagsIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'targetCrosshairs' icon
     */
    class TargetCrosshairsIcon extends Icon {
        constructor() {
            super(targetCrosshairs16X16);
        }
    }
    registerIcon('target-crosshairs-icon', TargetCrosshairsIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'targetCrosshairsProgress' icon
     */
    class TargetCrosshairsProgressIcon extends Icon {
        constructor() {
            super(targetCrosshairsProgress16X16);
        }
    }
    registerIcon('target-crosshairs-progress-icon', TargetCrosshairsProgressIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'threeDotsLine' icon
     */
    class ThreeDotsLineIcon extends Icon {
        constructor() {
            super(threeDotsLine16X16);
        }
    }
    registerIcon('three-dots-line-icon', ThreeDotsLineIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'thumbtack' icon
     */
    class ThumbtackIcon extends Icon {
        constructor() {
            super(thumbtack16X16);
        }
    }
    registerIcon('thumbtack-icon', ThumbtackIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'tileSize' icon
     */
    class TileSizeIcon extends Icon {
        constructor() {
            super(tileSize16X16);
        }
    }
    registerIcon('tile-size-icon', TileSizeIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'times' icon
     */
    class TimesIcon extends Icon {
        constructor() {
            super(times16X16);
        }
    }
    registerIcon('times-icon', TimesIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'trash' icon
     */
    class TrashIcon extends Icon {
        constructor() {
            super(trash16X16);
        }
    }
    registerIcon('trash-icon', TrashIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'triangle' icon
     */
    class TriangleIcon extends Icon {
        constructor() {
            super(triangle16X16);
        }
    }
    registerIcon('triangle-icon', TriangleIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'trueFalseRectangle' icon
     */
    class TrueFalseRectangleIcon extends Icon {
        constructor() {
            super(trueFalseRectangle16X16);
        }
    }
    registerIcon('true-false-rectangle-icon', TrueFalseRectangleIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'unlink' icon
     */
    class UnlinkIcon extends Icon {
        constructor() {
            super(unlink16X16);
        }
    }
    registerIcon('unlink-icon', UnlinkIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'unlock' icon
     */
    class UnlockIcon extends Icon {
        constructor() {
            super(unlock16X16);
        }
    }
    registerIcon('unlock-icon', UnlockIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'upload' icon
     */
    class UploadIcon extends Icon {
        constructor() {
            super(upload16X16);
        }
    }
    registerIcon('upload-icon', UploadIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'user' icon
     */
    class UserIcon extends Icon {
        constructor() {
            super(user16X16);
        }
    }
    registerIcon('user-icon', UserIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'watch' icon
     */
    class WatchIcon extends Icon {
        constructor() {
            super(watch16X16);
        }
    }
    registerIcon('watch-icon', WatchIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'waveform' icon
     */
    class WaveformIcon extends Icon {
        constructor() {
            super(waveform16X16);
        }
    }
    registerIcon('waveform-icon', WaveformIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'webviCustom' icon
     */
    class WebviCustomIcon extends Icon {
        constructor() {
            super(webviCustom16X16);
        }
    }
    registerIcon('webvi-custom-icon', WebviCustomIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'webviHost' icon
     */
    class WebviHostIcon extends Icon {
        constructor() {
            super(webviHost16X16);
        }
    }
    registerIcon('webvi-host-icon', WebviHostIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'windowCode' icon
     */
    class WindowCodeIcon extends Icon {
        constructor() {
            super(windowCode16X16);
        }
    }
    registerIcon('window-code-icon', WindowCodeIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'windowText' icon
     */
    class WindowTextIcon extends Icon {
        constructor() {
            super(windowText16X16);
        }
    }
    registerIcon('window-text-icon', WindowTextIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'wrenchHammer' icon
     */
    class WrenchHammerIcon extends Icon {
        constructor() {
            super(wrenchHammer16X16);
        }
    }
    registerIcon('wrench-hammer-icon', WrenchHammerIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'xmark' icon
     */
    class XmarkIcon extends Icon {
        constructor() {
            super(xmark16X16);
        }
    }
    registerIcon('xmark-icon', XmarkIcon);

    // AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
    /**
     * The icon component for the 'xmarkCheck' icon
     */
    class XmarkCheckIcon extends Icon {
        constructor() {
            super(xmarkCheck16X16);
        }
    }
    registerIcon('xmark-check-icon', XmarkCheckIcon);

    const styles$e = css `
    ${display('flex')}

    :host {
        font: ${bodyFont};
        cursor: pointer;
        justify-content: left;
    }

    .content {
        padding: 8px 4px;
    }

    :host(.selected) {
        box-shadow: none;
        outline: none;
        background-color: ${fillSelectedColor};
    }

    :host(:hover.selected) {
        background-color: ${fillHoverSelectedColor};
    }

    :host(:hover) {
        background-color: ${fillHoverColor};
    }

    :host(:hover):host([disabled]) {
        box-shadow: none;
        background-color: transparent;
    }

    :host(:${focusVisible}) {
        box-shadow: 0px 0px 0px 1px ${borderHoverColor} inset;
        outline: 1px solid ${borderHoverColor};
        outline-offset: -4px;
    }

    :host(:active) {
        box-shadow: none;
        outline: none;
        background-color: ${fillSelectedColor};
    }

    :host([disabled]) {
        color: ${bodyDisabledFontColor};
        cursor: default;
    }

    .content[disabled] {
        box-shadow: none;
        outline: none;
    }
`;

    /**
     * A nimble-styled HTML listbox option
     */
    class ListboxOption extends ListboxOption$1 {
        // Workaround for https://github.com/microsoft/fast/issues/5219
        get value() {
            return super.value;
        }
        set value(value) {
            // Coerce value to string
            super.value = `${value}`;
            if (this.$fastController.isConnected) {
                this.setAttribute('value', this.value);
            }
        }
        connectedCallback() {
            super.connectedCallback();
            this.setAttribute('value', this.value);
        }
    }
    const nimbleListboxOption = ListboxOption.compose({
        baseName: 'listbox-option',
        baseClass: ListboxOption$1,
        template: listboxOptionTemplate,
        styles: styles$e
    });
    DesignSystem.getOrCreate().withPrefix('nimble').register(nimbleListboxOption());

    const styles$d = css `
    ${display('grid')}

    :host {
        background: ${applicationBackgroundColor};
        border: ${borderWidth} solid ${popupBorderColor};
        margin: 0;
        padding: 4px;
        min-width: 168px;
        width: max-content;
        box-shadow: 0px 2px 3px ${popupBoxShadowColor};
    }
    ::slotted(*) {
        padding-left: 8px;
        padding-right: 8px;
    }
    ::slotted(hr) {
        box-sizing: content-box;
        height: 2px;
        margin: 4px;
        border: none;
        background: ${borderColor};
        opacity: 0.1;
    }
    ::slotted(header) {
        display: flex;
        font: ${groupHeaderFont};
        color: ${groupHeaderFontColor};
        text-transform: ${groupHeaderTextTransform};
        padding-top: 4px;
        padding-bottom: 4px;
    }
`;

    /**
     * A nimble-styled menu
     */
    class Menu extends Menu$1 {
    }
    /**
     * A function that returns a nimble-menu registration for configuring the component with a DesignSystem.
     * Implements {@link @microsoft/fast-foundation#menuTemplate}
     *
     * @public
     * @remarks
     * Generates HTML Element: \<nimble-menu\>
     *
     */
    const nimbleMenu = Menu.compose({
        baseName: 'menu',
        baseClass: Menu$1,
        template: menuTemplate,
        styles: styles$d
    });
    DesignSystem.getOrCreate().withPrefix('nimble').register(nimbleMenu());

    const styles$c = css `
    ${display('grid')}

    :host {
        contain: layout;
        overflow: visible;
        box-sizing: border-box;
        height: ${controlHeight};
        grid-template-columns: 0px 1fr;
        grid-template-rows: 1fr;
        justify-items: start;
        align-items: center;
        padding-left: 8px;
        padding-right: 8px;
        margin: 0 0;
        white-space: nowrap;
        color: ${bodyFontColor};
        fill: currentcolor;
        cursor: pointer;
        font: ${bodyFont};
    }
    :host(${focusVisible}) {
        outline: 2px solid ${borderHoverColor};
        outline-offset: -2px;
    }
    :host(:hover) {
        background: ${fillHoverColor};
    }
    :host(:active) {
        background: ${fillSelectedColor};
    }
    :host([disabled]) {
        color: ${bodyDisabledFontColor};
        fill: currentcolor;
        cursor: default;
    }
    :host([disabled]:hover) {
        background: transparent;
    }
    :host(.indent-1) {
        grid-template-columns: ${iconSize} 1fr;
        column-gap: 8px;
    }
    [part='start'] {
        display: contents;
    }
    slot[name='start']::slotted(*) {
        fill: currentcolor;
        width: ${iconSize};
        height: ${iconSize};
    }
    :host(.indent-1) .start {
        grid-column: 1;
    }
    :host(.indent-1) .content {
        grid-column: 2;
    }
`;

    /**
     * A nimble-styled menu-item
     */
    class MenuItem extends MenuItem$1 {
    }
    /**
     * A function that returns a nimble-menu-item registration for configuring the component with a DesignSystem.
     * Implements {@link @microsoft/fast-foundation#menuItemTemplate}
     *
     * @public
     * @remarks
     * Generates HTML Element: \<nimble-menu-item\>
     *
     */
    const nimbleMenuItem = MenuItem.compose({
        baseName: 'menu-item',
        baseClass: MenuItem$1,
        template: menuItemTemplate,
        styles: styles$c
    });
    DesignSystem.getOrCreate().withPrefix('nimble').register(nimbleMenuItem());

    const styles$b = css `
    ${display('inline-block')}

    :host {
        font: ${bodyFont};
        outline: none;
        user-select: none;
        color: ${bodyFontColor};
        height: calc(${labelHeight} + ${controlHeight});
    }

    :host([disabled]) {
        color: ${bodyDisabledFontColor};
        cursor: default;
    }

    .root {
        box-sizing: border-box;
        position: relative;
        display: flex;
        flex-direction: row;
        border-radius: 0px;
        border-bottom: ${borderWidth} solid rgba(${borderRgbPartialColor}, 0.3);
        padding-bottom: 1px;
        transition: border-bottom ${smallDelay}, padding-bottom ${smallDelay};
    }

    @media (prefers-reduced-motion) {
        .root {
            transition-duration: 0s;
        }
    }

    .root:hover {
        border-bottom: 2px solid ${borderHoverColor};
        padding-bottom: 0px;
    }

    :host([disabled]) .root,
    :host([disabled]) .root:hover {
        border-bottom: ${borderWidth} solid ${bodyDisabledFontColor};
        padding-bottom: 1px;
    }

    .control {
        -webkit-appearance: none;
        font: inherit;
        background: transparent;
        color: inherit;
        height: 28px;
        width: 100%;
        margin-top: auto;
        margin-bottom: auto;
        border: none;
    }

    .control:hover,
    .control:focus,
    .control:disabled,
    .control:active {
        outline: none;
    }

    .control::selection {
        color: ${controlLabelFontColor};
        background: rgba(${fillSelectedRgbPartialColor}, 0.3);
    }

    .control::placeholder {
        color: ${controlLabelFontColor};
    }

    .control:focus-within::placeholder {
        opacity: 1;
    }

    .control[disabled]::placeholder {
        color: ${bodyDisabledFontColor};
    }

    .label {
        display: flex;
        color: ${controlLabelFontColor};
        font: ${controlLabelFont};
    }

    .controls {
        display: flex;
        flex-direction: column;
    }

    .step-up,
    .step-down {
        display: inline-flex;
        height: 15px;
        width: 15px;
        cursor: pointer;
        justify-content: center;
        align-items: center;
    }

    .step-up svg,
    .step-down svg {
        height: ${iconSize};
        width: ${iconSize};
        fill: ${borderColor};
    }
`;

    /**
     * A nimble-styled HTML number input
     */
    class NumberField extends NumberField$1 {
    }
    /**
     * A function that returns a number-field registration for configuring the component with a DesignSystem.
     *
     * @public
     * @remarks
     * Generates HTML Element: \<nimble-number-field\>
     *
     */
    const nimbleNumberField = NumberField.compose({
        baseName: 'number-field',
        baseClass: NumberField$1,
        template: numberFieldTemplate,
        styles: styles$b,
        shadowOptions: {
            delegatesFocus: true
        },
        stepDownGlyph: arrowExpanderDown16X16.data,
        stepUpGlyph: arrowExpanderUp16X16.data
    });
    DesignSystem.getOrCreate().withPrefix('nimble').register(nimbleNumberField());

    const styles$a = css `
    ${display('inline-flex')}

    :host {
        box-sizing: border-box;
        color: ${bodyFontColor};
        font: ${bodyFont};
        height: ${controlHeight};
        position: relative;
        user-select: none;
        min-width: 250px;
        outline: none;
        vertical-align: top;
    }

    .listbox {
        box-sizing: border-box;
        display: inline-flex;
        flex-direction: column;
        left: 0;
        overflow-y: auto;
        position: absolute;
        width: 100%;
        ${
/*
 * The --max-height custom property is defined by fast-foundation.
 * See: https://github.com/microsoft/fast/blob/af1f8736ae9ff54a7449324bad952865981d1ece/packages/web-components/fast-foundation/src/select/select.ts#L199
 */ ''}
        max-height: calc(var(--max-height) - ${controlHeight});
        z-index: 1;
        padding: 4px;
        box-shadow: 0px 3px 3px ${popupBoxShadowColor};
        border: 1px solid ${popupBorderColor};
        background-color: ${applicationBackgroundColor};
        background-clip: padding-box;
    }

    .listbox[hidden] {
        display: none;
    }

    .control {
        align-items: center;
        box-sizing: border-box;
        cursor: pointer;
        display: flex;
        min-height: 100%;
        width: 100%;
        border-bottom: ${borderWidth} solid ${bodyDisabledFontColor};
        background-color: transparent;
        padding-left: 8px;
        padding-bottom: 1px;
    }

    :host([disabled]) .control {
        cursor: default;
    }

    :host(.open:not(:hover)) .control {
        border-bottom: ${borderWidth} solid ${borderHoverColor};
        transition: border-bottom ${smallDelay}, padding-bottom ${smallDelay};
    }

    :host(:hover) .control {
        border-bottom: 2px solid ${borderHoverColor};
        padding-bottom: 0px;
        transition: border-bottom ${smallDelay}, padding-bottom ${smallDelay};
    }

    :host([disabled]) .control,
    :host([disabled]) .control:hover {
        border-bottom: ${borderWidth} solid ${bodyDisabledFontColor};
        padding-bottom: 1px;
        color: ${bodyDisabledFontColor};
    }

    :host([open][position='above']) .listbox {
        border-bottom-left-radius: 0;
        border-bottom-right-radius: 0;
    }

    :host([open][position='below']) .listbox {
        border-top-left-radius: 0;
        border-top-right-radius: 0;
    }

    :host([open][position='above']) .listbox {
        bottom: ${controlHeight};
    }

    :host([open][position='below']) .listbox {
        top: calc(${controlHeight} + ${smallPadding});
    }

    .selected-value {
        flex: 1 1 auto;
        font-family: inherit;
        text-align: start;
        white-space: nowrap;
        text-overflow: ellipsis;
        overflow: hidden;
    }

    .indicator {
        flex: 0 0 auto;
        margin-inline-start: 1em;
        padding-right: 8px;
        display: flex;
        justify-content: center;
        align-items: center;
    }

    .indicator slot[name='indicator'] svg {
        width: ${iconSize};
        height: ${iconSize};
        fill: ${bodyFontColor};
    }

    :host([disabled]) .indicator slot[name='indicator'] svg {
        fill: ${bodyDisabledFontColor};
    }

    slot[name='listbox'] {
        display: none;
        width: 100%;
    }

    :host([open]) slot[name='listbox'] {
        display: flex;
        position: absolute;
    }

    .end {
        margin-inline-start: auto;
    }

    ::slotted([role='option']),
    ::slotted(option) {
        flex: 0 0 auto;
    }
`;

    /**
     * A nimble-styed HTML select
     */
    class Select extends Select$1 {
        get value() {
            return super.value;
        }
        set value(value) {
            super.value = value;
            // Workaround for https://github.com/microsoft/fast/issues/5139
            // When the value property is set very early in the element's lifecycle (e.g. Angular value binding),
            // the options property will not be set yet. As a workaround, we mark the listbox-option element with
            // the selected attribute, which will set the initial value correctly.
            if (value !== null && this.options.length === 0) {
                const options = this.querySelectorAll('option,[role="option"]');
                options.forEach(option => {
                    if (option.getAttribute('value') === value) {
                        option.setAttribute('selected', '');
                    }
                });
            }
        }
        // Workaround for https://github.com/microsoft/fast/issues/5123
        setPositioning() {
            if (!this.$fastController.isConnected) {
                // Don't call setPositioning() until we're connected,
                // since this.forcedPosition isn't initialized yet.
                return;
            }
            super.setPositioning();
        }
        connectedCallback() {
            super.connectedCallback();
            // Call setPositioning() after this.forcedPosition is initialized.
            this.setPositioning();
        }
    }
    const nimbleSelect = Select.compose({
        baseName: 'select',
        baseClass: Select$1,
        template: selectTemplate,
        styles: styles$a,
        indicator: arrowExpanderDown16X16.data
    });
    DesignSystem.getOrCreate().withPrefix('nimble').register(nimbleSelect());

    const styles$9 = css `
    ${display('inline-flex')}

    :host {
        outline: none;
        font: ${buttonLabelFont};
        color: ${buttonLabelFontColor};
        flex-direction: column;
        cursor: pointer;
        --ni-private-switch-height: 24px;
        --ni-private-switch-indicator-size: 16px;
        padding-bottom: calc(
            ${controlHeight} - var(--ni-private-switch-height)
        );
    }

    :host([disabled]) {
        cursor: default;
        color: ${buttonLabelDisabledFontColor};
    }

    .label {
        color: ${controlLabelFontColor};
        font: ${controlLabelFont};
    }

    :host([disabled]) .label {
        color: ${controlLabelDisabledFontColor};
    }

    .label__hidden {
        display: none;
        visibility: hidden;
    }

    .switch-container {
        display: flex;
        align-items: center;
    }

    slot[name='unchecked-message']::slotted(*) {
        margin-inline-end: 8px;
    }

    .switch {
        display: flex;
        height: var(--ni-private-switch-height);
        width: calc(var(--ni-private-switch-height) * 2);
        box-sizing: border-box;
        background-color: ${fillHoverColor};
        border-radius: calc(var(--ni-private-switch-height) / 2);
        align-items: center;
        border: calc(${borderWidth} * 2) solid transparent;
    }

    :host([disabled]) .switch {
        background-color: var(--ni-private-switch-background-disabled-color);
    }

    :host(${focusVisible}) .switch {
        border-color: ${borderHoverColor};
    }

    .checked-indicator-spacer {
        flex-grow: 0;
        transition: flex-grow ${smallDelay} ease-in-out;
    }

    :host([aria-checked='true']) .checked-indicator-spacer {
        flex-grow: 1;
        transition: flex-grow ${smallDelay} ease-in-out;
    }

    .checked-indicator {
        display: flex;
        justify-content: center;
        align-items: center;
        background-color: var(--ni-private-switch-indicator-background-color);
        box-sizing: border-box;
        width: var(--ni-private-switch-indicator-size);
        height: var(--ni-private-switch-indicator-size);
        border-radius: calc(var(--ni-private-switch-indicator-size) / 2);
        margin: calc(
            calc(
                    var(--ni-private-switch-height) -
                        var(--ni-private-switch-indicator-size)
                ) / 2
        );
        border: ${borderWidth} solid
            var(--ni-private-switch-indicator-border-color);
    }

    :host(:hover) .checked-indicator {
        border: calc(${borderWidth} * 2) solid ${borderHoverColor};
    }

    :host([disabled]) .checked-indicator {
        background-color: var(
            --ni-private-switch-indicator-background-disabled-color
        );
        border: ${borderWidth} solid
            var(--ni-private-switch-indicator-border-disabled-color);
    }

    :host(${focusVisible}) .checked-indicator {
        border: ${borderWidth} solid ${borderHoverColor};
    }

    .checked-indicator-inner {
        width: calc(var(--ni-private-switch-indicator-size) / 2);
        height: calc(var(--ni-private-switch-indicator-size) / 2);
        border-radius: calc(var(--ni-private-switch-indicator-size) / 4);
        background-color: var(--ni-private-switch-indicator-border-color);
        opacity: 0;
        transition: opacity ${smallDelay} ease-in-out;
    }

    :host([disabled]) .checked-indicator-inner {
        background-color: var(
            --ni-private-switch-indicator-border-disabled-color
        );
    }

    :host([aria-checked='true']) .checked-indicator-inner {
        opacity: 1;
        transition: opacity ${smallDelay} ease-in-out;
    }

    slot[name='checked-message']::slotted(*) {
        margin-inline-start: 8px;
    }

    @media (prefers-reduced-motion) {
        .checked-indicator-inner,
        .checked-indicator-spacer {
            transition-duration: 0s;
        }
    }
`.withBehaviors(themeBehavior(css `
            ${'' /* Light theme */}
            :host {
                --ni-private-switch-background-disabled-color: ${hexToRgbaCssColor(Black91, 0.07)};
                --ni-private-switch-indicator-background-color: ${White};
                --ni-private-switch-indicator-background-disabled-color: ${hexToRgbaCssColor(White, 0.1)};
                --ni-private-switch-indicator-border-color: ${Black91};
                --ni-private-switch-indicator-border-disabled-color: ${hexToRgbaCssColor(Black91, 0.3)};
            }
        `, css `
            ${'' /* Dark theme */}
            :host {
                --ni-private-switch-background-disabled-color: ${hexToRgbaCssColor(Black15, 0.07)};
                --ni-private-switch-indicator-background-color: ${hexToRgbaCssColor(Black91, 0.3)};
                --ni-private-switch-indicator-background-disabled-color: ${hexToRgbaCssColor(Black91, 0.1)};
                --ni-private-switch-indicator-border-color: ${Black7};
                --ni-private-switch-indicator-border-disabled-color: ${hexToRgbaCssColor(Black7, 0.3)};
            }
        `, css `
            ${'' /* Color theme */}
            :host {
                --ni-private-switch-background-disabled-color: ${hexToRgbaCssColor(White, 0.07)};
                --ni-private-switch-indicator-background-color: ${hexToRgbaCssColor(White, 0.1)};
                --ni-private-switch-indicator-background-disabled-color: ${hexToRgbaCssColor(White, 0.1)};
                --ni-private-switch-indicator-border-color: ${White};
                --ni-private-switch-indicator-border-disabled-color: ${hexToRgbaCssColor(White, 0.3)};
            }
        `));

    // prettier-ignore
    const template$2 = html `
    <template
        role="switch"
        aria-checked="${x => x.checked}"
        aria-disabled="${x => x.disabled}"
        aria-readonly="${x => x.readOnly}"
        tabindex="${x => (x.disabled ? null : 0)}"
        @keypress="${(x, c) => x.keypressHandler(c.event)}"
        @click="${(x, c) => x.clickHandler(c.event)}"
        class="${x => (x.checked ? 'checked' : '')}"
    >
        <label
            part="label"
            class="${x => (x.defaultSlottedNodes.length ? 'label' : 'label label__hidden')}"
        >
            <slot ${slotted('defaultSlottedNodes')}></slot>
        </label>
        <div class="switch-container">
            <span class="status-message unchecked-message" part="unchecked-message">
                <slot name="unchecked-message"></slot>
            </span>
            <div part="switch" class="switch">
                <slot name="switch">
                    <span class="checked-indicator-spacer"></span>
                    <span class="checked-indicator" part="checked-indicator">
                        <span class="checked-indicator-inner">
                    </span>
                </slot>
            </div>
            <span class="status-message checked-message" part="checked-message">
                <slot name="checked-message"></slot>
            </span>
        </div>
    </template>
`;

    /**
     * A nimble-styled switch control.
     */
    class Switch extends Switch$1 {
    }
    const nimbleSwitch = Switch.compose({
        baseClass: Switch$1,
        baseName: 'switch',
        template: template$2,
        styles: styles$9
    });
    DesignSystem.getOrCreate().withPrefix('nimble').register(nimbleSwitch());

    const styles$8 = css `
    ${display('inline-flex')}

    :host {
        box-sizing: border-box;
        font: ${bodyFont};
        height: ${controlHeight};
        padding: calc(${standardPadding} / 2) ${standardPadding}
            calc(${standardPadding} / 2 - ${borderWidth});
        color: ${bodyFontColor};
        align-items: center;
        justify-content: center;
        cursor: pointer;
        ${ /* Separate focus indicator from active indicator */''}
        border-bottom: transparent ${borderWidth} solid;
    }

    :host(:hover) {
        background-color: ${fillHoverColor};
    }

    :host(:focus) {
        outline: none;
    }

    :host(${focusVisible}) {
        outline: none;
        box-shadow: 0 calc(${borderWidth} * -1) ${borderHoverColor} inset;
        transition: box-shadow ${mediumDelay} ease-in-out;
    }

    @media (prefers-reduced-motion) {
        :host(${focusVisible}) {
            transition-duration: 0.01s;
        }
    }

    :host(:active) {
        background: none;
    }

    :host([disabled]) {
        cursor: default;
        color: ${bodyDisabledFontColor};
        background: none;
    }
`;

    /**
     * A nimble-styled HTML tab
     */
    class Tab extends Tab$1 {
    }
    const nimbleTab = Tab.compose({
        baseName: 'tab',
        baseClass: Tab$1,
        template: tabTemplate,
        styles: styles$8
    });
    DesignSystem.getOrCreate().withPrefix('nimble').register(nimbleTab());

    const styles$7 = css `
    ${display('block')}

    :host {
        box-sizing: border-box;
        font: ${bodyFont};
        color: ${bodyFontColor};
        padding-top: ${standardPadding};
    }
`;

    /**
     * A nimble-styled tab panel
     */
    class TabPanel extends TabPanel$1 {
    }
    const nimbleTabPanel = TabPanel.compose({
        baseName: 'tab-panel',
        baseClass: TabPanel$1,
        template: tabPanelTemplate,
        styles: styles$7
    });
    DesignSystem.getOrCreate().withPrefix('nimble').register(nimbleTabPanel());

    const styles$6 = css `
    ${display('grid')}

    :host {
        box-sizing: border-box;
        grid-template-columns: auto auto 1fr;
        grid-template-rows: auto 1fr;
    }

    .tablist {
        display: grid;
        grid-template-rows: auto auto;
        grid-template-columns: auto;
        width: max-content;
        align-self: end;
    }

    .activeIndicator {
        grid-row: 2;
        height: calc(${borderWidth} * 2);
        background-color: ${borderHoverColor};
    }

    .activeIndicatorTransition {
        transition: transform ${smallDelay} ease-in-out;
    }

    @media (prefers-reduced-motion) {
        .activeIndicatorTransition {
            transition: transform 0.01s;
        }
    }

    .tabpanel {
        grid-row: 2;
        grid-column-start: 1;
        grid-column-end: 4;
    }
`;

    /**
     * A nimble-styled tabs control
     */
    class Tabs extends Tabs$1 {
    }
    const nimbleTabs = Tabs.compose({
        baseName: 'tabs',
        baseClass: Tabs$1,
        template: tabsTemplate,
        styles: styles$6
    });
    DesignSystem.getOrCreate().withPrefix('nimble').register(nimbleTabs());

    const styles$5 = css `
    ${display('flex')}

    :host {
        align-items: center;
        height: ${controlHeight};
        box-sizing: border-box;
        font: ${bodyFont};
        color: ${bodyFontColor};
    }

    .separator {
        display: inline-block;
        height: 24px;
        border-left: calc(${borderWidth} * 2) solid
            rgba(${borderRgbPartialColor}, 0.3);
        margin: calc(${standardPadding} / 4) calc(${standardPadding} / 2);
    }
`;

    const template$1 = html `
    <template slot="end">
        <div class="separator"></div>
        <slot></slot>
    </template>
`;

    /**
     * A nimble-styled container for toolbar content next to tabs.
     */
    class TabsToolbar extends FoundationElement {
    }
    const nimbleTabsToolbar = TabsToolbar.compose({
        baseName: 'tabs-toolbar',
        template: template$1,
        styles: styles$5
    });
    DesignSystem.getOrCreate().withPrefix('nimble').register(nimbleTabsToolbar());

    var TextAreaAppearance;
    (function (TextAreaAppearance) {
        TextAreaAppearance["Outline"] = "outline";
        TextAreaAppearance["Block"] = "block";
    })(TextAreaAppearance || (TextAreaAppearance = {}));

    const styles$4 = css `
    ${display('inline-block')}

    :host {
        font: ${bodyFont};
        outline: none;
        user-select: none;
        color: ${bodyFontColor};
    }

    :host([disabled]) {
        color: ${bodyDisabledFontColor};
    }

    .label {
        display: flex;
        color: ${controlLabelFontColor};
        font: ${controlLabelFont};
    }

    :host([disabled]) .label {
        color: ${controlLabelDisabledFontColor};
    }

    .control {
        -webkit-appearance: none;
        font: inherit;
        outline: none;
        box-sizing: border-box;
        position: relative;
        color: inherit;
        border-radius: 0px;
        align-items: flex-end;
        border: ${borderWidth} solid transparent;
        padding: 8px;
        transition: box-shadow ${smallDelay}, border ${smallDelay};
        resize: none;
    }

    @media (prefers-reduced-motion) {
        .control {
            transition-duration: 0s;
        }
    }

    .control:hover {
        border-color: ${borderHoverColor};
        box-shadow: 0px 0px 0px 1px ${borderHoverColor};
    }

    .control:focus-within {
        border-color: ${borderHoverColor};
    }

    .control[readonly],
    .control[readonly]:hover,
    .control[readonly]:hover:focus-within,
    .control[disabled],
    .control[disabled]:hover {
        border-color: rgba(${borderRgbPartialColor}, 0.1);
        box-shadow: none;
    }

    .control::selection {
        color: ${controlLabelFontColor};
        background: rgba(${fillSelectedRgbPartialColor}, 0.3);
    }

    .control::placeholder {
        color: ${controlLabelFontColor};
    }

    .control[disabled]::placeholder {
        color: ${controlLabelDisabledFontColor};
    }

    :host([resize='both']) .control {
        resize: both;
    }
    :host([resize='horizontal']) .control {
        resize: horizontal;
    }
    :host([resize='vertical']) .control {
        resize: vertical;
    }
`
        // prettier-ignore
        .withBehaviors(appearanceBehavior(TextAreaAppearance.Outline, css `
                .control {
                    border-color: rgba(${borderRgbPartialColor}, 0.3);
                    background-color: transparent;
                }
            `), appearanceBehavior(TextAreaAppearance.Block, css `
                .control {
                    background-color: rgba(${borderRgbPartialColor}, 0.1);
                }

                :host([readonly]) .control {
                    background-color: transparent;
                }

                :host([disabled]) .control {
                    border-color: transparent;
                    background-color: rgba(${borderRgbPartialColor}, 0.1);
                }
            `));

    /**
     * A nimble-styed HTML text area
     */
    class TextArea extends TextArea$1 {
        constructor() {
            super(...arguments);
            /**
             * The appearance the text area should have.
             *
             * @public
             * @remarks
             * HTML Attribute: appearance
             */
            this.appearance = TextAreaAppearance.Outline;
        }
    }
    __decorate([
        attr
    ], TextArea.prototype, "appearance", void 0);
    const nimbleTextArea = TextArea.compose({
        baseName: 'text-area',
        baseClass: TextArea$1,
        template: textAreaTemplate,
        styles: styles$4,
        shadowOptions: {
            delegatesFocus: true
        }
    });
    DesignSystem.getOrCreate().withPrefix('nimble').register(nimbleTextArea());

    /**
     * Values for the 'appearance' property of the text field
     */
    var TextFieldAppearance;
    (function (TextFieldAppearance) {
        TextFieldAppearance["Underline"] = "underline";
        TextFieldAppearance["Outline"] = "outline";
        TextFieldAppearance["Block"] = "block";
    })(TextFieldAppearance || (TextFieldAppearance = {}));

    const styles$3 = css `
    ${display('inline-block')}

    :host {
        font: ${bodyFont};
        outline: none;
        user-select: none;
        --webkit-user-select: none;
        color: ${bodyFontColor};
        height: calc(${labelHeight} + ${controlHeight});
    }

    :host([disabled]) {
        color: ${bodyDisabledFontColor};
    }

    .label {
        display: flex;
        color: ${controlLabelFontColor};
        font: ${controlLabelFont};
    }

    :host([disabled]) .label {
        color: ${controlLabelDisabledFontColor};
    }

    .root {
        box-sizing: border-box;
        position: relative;
        display: flex;
        flex-direction: row;
        border-radius: 0px;
        font: inherit;
        transition: border-bottom ${smallDelay}, padding-bottom ${smallDelay};
        align-items: center;
        --ni-private-hover-bottom-border-width: 2px;
        border: 0px solid rgba(${borderRgbPartialColor}, 0.3);
        border-bottom-width: var(--ni-private-bottom-border-width);
        padding-bottom: calc(
            var(--ni-private-hover-bottom-border-width) -
                var(--ni-private-bottom-border-width)
        );
    }

    @media (prefers-reduced-motion) {
        .root {
            transition-duration: 0s;
        }
    }

    :host(.invalid) .root {
        border-bottom-color: ${failColor};
    }

    :host([readonly]:not([disabled])) .root {
        border: ${borderWidth} solid rgba(${borderRgbPartialColor}, 0.1);
        padding: 0px;
        padding-bottom: 1px;
        background-color: transparent;
    }

    :host([disabled]) .root {
        border-color: rgba(${borderRgbPartialColor}, 0.1);
    }

    .root:hover {
        --ni-private-bottom-border-width: var(
            --ni-private-hover-bottom-border-width
        );
        border-bottom-color: ${borderHoverColor};
    }

    :host([disabled]) .root:hover {
        --ni-private-bottom-border-width: 1px;
    }

    .root:focus-within {
        border-bottom-color: ${borderHoverColor};
    }

    [part='start'] {
        display: none;
    }

    .control {
        -webkit-appearance: none;
        font: inherit;
        background: transparent;
        color: inherit;
        padding-top: 0px;
        padding-bottom: 0px;
        height: calc(
            ${controlHeight} - ${borderWidth} -
                var(--ni-private-hover-bottom-border-width)
        );
        width: 100%;
        margin-top: auto;
        margin-bottom: auto;
        padding-left: calc(${standardPadding} / 2);
        padding-right: calc(${standardPadding} / 2);
        border: none;
        text-overflow: ellipsis;
    }

    .control:hover,
    .control:focus,
    .control:disabled,
    .control:active {
        outline: none;
    }

    .control::selection {
        color: ${controlLabelFontColor};
        background: rgba(${fillSelectedRgbPartialColor}, 0.3);
    }

    .control::placeholder {
        color: ${controlLabelFontColor};
    }

    .control:not([readonly]):focus-within::placeholder {
        opacity: 1;
    }

    .control[disabled]::placeholder {
        color: ${bodyDisabledFontColor};
    }

    [part='end'] {
        display: none;
    }

    :host(.invalid) [part='end'] {
        display: contents;
    }

    :host(.invalid) [part='end'] svg {
        height: ${iconSize};
        width: ${iconSize};
        padding-right: 8px;
        flex: none;
    }

    :host(.invalid) [part='end'] path {
        fill: ${failColor};
    }

    :host([disabled]) [part='end'] path {
        fill: ${bodyDisabledFontColor};
    }

    .errortext {
        display: none;
    }

    :host(.invalid) .errortext {
        display: block;
        font: ${errorTextFont};
        color: ${failColor};
        width: 100%;
        position: absolute;
        top: ${controlHeight};
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    :host(.invalid[readonly]:not([disabled])) .errortext {
        top: calc(${controlHeight} - ${borderWidth});
    }

    :host(.invalid) .error-text:empty {
        display: none;
    }

    :host([disabled]) .errortext {
        color: ${bodyDisabledFontColor};
    }
`.withBehaviors(appearanceBehavior(TextFieldAppearance.Underline, css `
            .root {
                --ni-private-bottom-border-width: 1px;
                padding-top: ${borderWidth};
                padding-left: ${borderWidth};
                padding-right: ${borderWidth};
            }
        `), appearanceBehavior(TextFieldAppearance.Block, css `
            .root {
                background-color: rgba(${borderRgbPartialColor}, 0.1);
                --ni-private-bottom-border-width: 0px;
                padding-top: ${borderWidth};
                padding-left: ${borderWidth};
                padding-right: ${borderWidth};
            }

            .root:focus-within {
                --ni-private-bottom-border-width: 1px;
            }

            .root:focus-within:hover {
                --ni-private-bottom-border-width: var(
                    --ni-private-hover-bottom-border-width
                );
            }

            :host(.invalid) .root {
                --ni-private-bottom-border-width: 1px;
            }

            :host(.invalid) .root:hover {
                --ni-private-bottom-border-width: var(
                    --ni-private-hover-bottom-border-width
                );
            }

            :host([disabled]) .root {
                background-color: rgba(${borderRgbPartialColor}, 0.07);
            }

            :host([disabled]) .root:hover {
                --ni-private-bottom-border-width: 0px;
            }

            :host(.invalid[disabled]) .root {
                --ni-private-bottom-border-width: 1px;
            }
        `), appearanceBehavior(TextFieldAppearance.Outline, css `
            .root {
                --ni-private-bottom-border-width: 1px;
                border-width: ${borderWidth};
                border-bottom-width: var(--ni-private-bottom-border-width);
            }

            :host(.invalid) .errortext {
                top: calc(${controlHeight} - ${borderWidth});
            }
        `), themeBehavior(css `
            ${'' /* Light theme */}
            .control::-ms-reveal {
                filter: invert(0%);
            }
        `, css `
            ${'' /* Dark theme */}
            .control::-ms-reveal {
                filter: invert(100%);
            }
        `, 
    // Color theme
    Theme.Dark));

    /**
     * A nimble-styed HTML text input
     */
    class TextField extends TextField$1 {
        constructor() {
            super(...arguments);
            /**
             * The appearance the text field should have.
             *
             * @public
             * @remarks
             * HTML Attribute: appearance
             */
            this.appearance = TextFieldAppearance.Underline;
        }
        connectedCallback() {
            super.connectedCallback();
            this.control.setAttribute('aria-errormessage', 'errortext');
        }
    }
    __decorate([
        attr
    ], TextField.prototype, "appearance", void 0);
    __decorate([
        attr({ attribute: 'error-text' })
    ], TextField.prototype, "errorText", void 0);
    const nimbleTextField = TextField.compose({
        baseName: 'text-field',
        baseClass: TextField$1,
        template: textFieldTemplate,
        styles: styles$3,
        shadowOptions: {
            delegatesFocus: true
        },
        end: html `
        ${exclamationMark16X16.data}
        <div
            id="errortext"
            class="errortext"
            title="${x => x.errorText}"
            aria-live="polite"
        >
            ${x => x.errorText}
        </div>
    `
    });
    DesignSystem.getOrCreate().withPrefix('nimble').register(nimbleTextField());

    const styles$2 = css `
    ${styles$j}

    .control[aria-pressed='true'] {
        background-color: ${fillSelectedColor};
        border-color: ${fillSelectedColor};
    }

    .control[aria-pressed='true']:hover {
        background-color: ${fillSelectedColor};
    }

    .control[aria-pressed='true']${focusVisible} {
        background-color: ${fillSelectedColor};
    }

    .control[aria-pressed='true'][disabled] {
        background-color: ${fillSelectedColor};
        border-color: ${fillSelectedColor};
    }

    .control[aria-pressed='true'][disabled]:hover {
        background-color: ${fillSelectedColor};
        border-color: ${fillSelectedColor};
    }
`;

    const template = (context, definition) => html `
    <div
        role="button"
        part="control"
        aria-pressed="${(x) => x.checked}"
        aria-disabled="${(x) => x.disabled}"
        aria-readonly="${(x) => x.readOnly}"
        tabindex="${(x) => (x.disabled ? null : 0)}"
        @keypress="${(x, c) => x.keypressHandler(c.event)}"
        @click="${(x, c) => x.clickHandler(c.event)}"
        class="control ${(x) => (x.checked ? 'checked' : '')}"
        ?disabled="${x => x.disabled}"
        ${ref('control')}
    >
        ${startSlotTemplate(context, definition)}
        <span class="content" part="content">
            <slot></slot>
        </span>
        ${endSlotTemplate(context, definition)}
    </div>
`;

    /**
     * A nimble-styled toggle button control.
     */
    class ToggleButton extends Switch$1 {
        constructor() {
            super(...arguments);
            /**
             * The appearance the button should have.
             *
             * @public
             * @remarks
             * HTML Attribute: appearance
             */
            this.appearance = ButtonAppearance.Outline;
            /**
             * Specify as 'true' to hide the text content of the button. The button will
             * become square, and the text content will be used as the label of the button
             * for accessibility purposes.
             *
             * @public
             * @remarks
             * HTML Attribute: content-hidden
             */
            this.contentHidden = false;
        }
    }
    __decorate([
        attr
    ], ToggleButton.prototype, "appearance", void 0);
    __decorate([
        attr({ attribute: 'content-hidden', mode: 'boolean' })
    ], ToggleButton.prototype, "contentHidden", void 0);
    applyMixins(ToggleButton, StartEnd);
    const nimbleToggleButton = ToggleButton.compose({
        baseName: 'toggle-button',
        template,
        styles: styles$2,
        shadowOptions: {
            delegatesFocus: true
        }
    });
    DesignSystem.getOrCreate().withPrefix('nimble').register(nimbleToggleButton());

    const groupSelectedAttribute = 'group-selected';
    var TreeViewSelectionMode;
    (function (TreeViewSelectionMode) {
        TreeViewSelectionMode["All"] = "all";
        TreeViewSelectionMode["LeavesOnly"] = "leaves-only";
    })(TreeViewSelectionMode || (TreeViewSelectionMode = {}));

    /* eslint-disable */
    /**
     * Behavior to conditionally apply LTR and RTL stylesheets. To determine which to apply,
     * the behavior will use the nearest DesignSystemProvider's 'direction' design system value.
     *
     * @public
     * @example
     * ```ts
     * import { css } from "@microsoft/fast-element";
     * import { DirectionalStyleSheetBehavior } from "@microsoft/fast-foundation";
     *
     * css`
     *  // ...
     * `.withBehaviors(new DirectionalStyleSheetBehavior(
     *   css`:host { content: "ltr"}`),
     *   css`:host { content: "rtl"}`),
     * )
     * ```
     */
    class DirectionalStyleSheetBehavior {
        constructor(ltr, rtl) {
            this.cache = new WeakMap();
            this.ltr = ltr;
            this.rtl = rtl;
        }
        /**
         * @internal
         */
        bind(source) {
            this.attach(source);
        }
        /**
         * @internal
         */
        unbind(source) {
            const cache = this.cache.get(source);
            if (cache) {
                direction.unsubscribe(cache);
            }
        }
        attach(source) {
            const subscriber = this.cache.get(source) ||
                new DirectionalStyleSheetBehaviorSubscription(this.ltr, this.rtl, source);
            const value = direction.getValueFor(source);
            direction.subscribe(subscriber);
            subscriber.attach(value);
            this.cache.set(source, subscriber);
        }
    }
    /**
     * Subscription for {@link DirectionalStyleSheetBehavior}
     */
    class DirectionalStyleSheetBehaviorSubscription {
        constructor(ltr, rtl, source) {
            this.ltr = ltr;
            this.rtl = rtl;
            this.source = source;
            this.attached = null;
        }
        handleChange({ target, token, }) {
            this.attach(token.getValueFor(target));
        }
        attach(direction) {
            if (this.attached !== this[direction]) {
                if (this.attached !== null) {
                    this.source.$fastController.removeStyles(this.attached);
                }
                this.attached = this[direction];
                if (this.attached !== null) {
                    this.source.$fastController.addStyles(this.attached);
                }
            }
        }
    }

    const styles$1 = (context, _definition) => css `
            ${display('block')}

            :host {
                ${
/* don't set font-size here or else it overrides what we set on .items */ ''}
                font-family: ${bodyFontFamily};
                font-weight: ${bodyFontWeight};
                contain: content;
                position: relative;
                outline: none;
                color: ${bodyFontColor};
                cursor: pointer;
                --ni-private-tree-item-nested-width: 0;
            }

            ${ /* this controls the side border */''}
            :host([${groupSelectedAttribute}])::after {
                background: ${borderHoverColor};
                border-radius: 0px;
                content: '';
                display: block;
                position: absolute;
                top: 0px;
                width: calc(${borderWidth} * 2);
                height: calc(${iconSize} * 2);
            }

            .positioning-region {
                display: flex;
                position: relative;
                box-sizing: border-box;
                height: calc(${iconSize} * 2);
            }

            .positioning-region:hover {
                background: ${fillHoverColor};
            }

            :host(${focusVisible}) .positioning-region {
                box-shadow: 0px 0px 0px ${borderWidth} ${borderHoverColor} inset;
                outline: ${borderWidth} solid ${borderHoverColor};
                outline-offset: -2px;
            }

            :host([selected]) .positioning-region {
                background: ${fillSelectedColor};
            }

            :host([selected]) .positioning-region:hover {
                background: ${fillHoverSelectedColor};
            }

            .positioning-region::before {
                content: '';
                display: block;
                width: var(--ni-private-tree-item-nested-width);
                flex-shrink: 0;
            }

            .content-region {
                display: inline-flex;
                align-items: center;
                white-space: nowrap;
                width: 100%;
                padding-left: 10px;
                font: inherit;
                font-size: ${bodyFontSize};
                user-select: none;
            }

            :host(${focusVisible}) .content-region {
                outline: none;
            }

            :host(.nested) .content-region {
                position: relative;
                margin-inline-start: ${iconSize};
            }

            :host([disabled]) .content-region {
                opacity: 0.5;
                cursor: not-allowed;
            }

            .expand-collapse-button {
                background: none;
                border: none;
                outline: none;
                width: ${iconSize};
                height: ${iconSize};
                padding: 0px;
                justify-content: center;
                align-items: center;
                cursor: pointer;
                margin-left: 10px;
            }

            :host(.nested) .expand-collapse-button {
                position: absolute;
            }

            .expand-collapse-button svg {
                width: ${iconSize};
                height: ${iconSize};
                transition: transform 0.2s ease-in;
                pointer-events: none;
                fill: currentcolor;
            }

            ${
/* this rule keeps children without an icon text aligned with parents */ ''}
            span[part="start"] {
                width: ${iconSize};
            }

            ${
/* the start class is applied when the corresponding slots is filled */ ''}
            .start {
                display: flex;
                fill: currentcolor;
                margin-inline-start: ${iconSize};
                margin-inline-end: ${iconSize};
            }

            slot[name='start']::slotted(*) {
                width: ${iconSize};
                height: ${iconSize};
            }

            ::slotted(${context.tagFor(TreeItem$1)}) {
                --ni-private-tree-item-nested-width: 1em;
                --ni-private-expand-collapse-button-nested-width: calc(
                    ${iconSize} * -1
                );
            }

            ${
/* the end class is applied when the corresponding slots is filled */ ''}
            .end {
                display: flex;
                fill: currentcolor;
                margin-inline-start: ${iconSize};
            }

            .items {
                display: none;
                ${
/*
 * this controls the nested indentation (by affecting .positioning-region::before)
 * it must minimally contain arithmetic with an em and a px value
 * make it larger or shorter by changing the px value
 */ ''}
                font-size: calc(1em + (${iconSize} * 2));
            }

            :host([expanded]) .items {
                display: block;
            }
        `
        // prettier-ignore
        .withBehaviors(new DirectionalStyleSheetBehavior(css `
                        ${ /* ltr styles */''}
                        :host(.nested) .expand-collapse-button {
                            left: var(
                                --ni-private-expand-collapse-button-nested-width,
                                calc(${iconSize} * -1)
                            );
                        }

                        .expand-collapse-button svg {
                            transform: rotate(90deg);
                        }

                        :host([expanded]) .expand-collapse-button svg {
                            transform: rotate(180deg);
                        }
                    `, css `
                        ${ /* rtl styles */''}
                        :host(.nested) .expand-collapse-button {
                            right: var(
                                --ni-private-expand-collapse-button-nested-width,
                                calc(${iconSize} * -1)
                            );
                        }

                        .expand-collapse-button svg {
                            transform: rotate(180deg);
                        }

                        :host([expanded]) .expand-collapse-button svg {
                            transform: rotate(135deg);
                        }
                    `));

    /**
     * A function that returns a nimble-tree-item registration for configuring the component with a DesignSystem.
     * Implements {@link @microsoft/fast-foundation#treeItemTemplate}
     *
     *
     * @public
     * @remarks
     * Generates HTML Element: \<nimble-tree-item\>
     *
     */
    class TreeItem extends TreeItem$1 {
        constructor() {
            super();
            this.treeView = null;
            this.handleClickOverride = (event) => {
                if (event.composedPath().includes(this.expandCollapseButton)) {
                    // just have base class handle click event for glyph
                    return;
                }
                const treeItem = this.getImmediateTreeItem(event.target);
                if (treeItem.disabled || treeItem !== this) {
                    // don't allow base TreeItem to emit a 'selected-change' event when a disabled item is clicked
                    event.stopImmediatePropagation();
                    return;
                }
                const leavesOnly = this.treeView.selectionMode === TreeViewSelectionMode.LeavesOnly;
                const hasChildren = this.hasChildTreeItems();
                if ((leavesOnly && !hasChildren) || !leavesOnly) {
                    const selectedTreeItem = this.getImmediateTreeItem(this.treeView.currentSelected);
                    // deselect currently selected item if different than this instance
                    if (selectedTreeItem && this !== this.treeView.currentSelected) {
                        selectedTreeItem.selected = false;
                    }
                    this.selected = true;
                }
                else {
                    // implicit hasChildren && leavesOnly, so only allow expand/collapse, not select
                    this.expanded = !this.expanded;
                }
                // don't allow base class to process click event
                event.stopImmediatePropagation();
            };
            // This prevents the toggling of selected state when a TreeItem is clicked multiple times,
            // which is what the FAST TreeItem allows
            this.handleSelectedChange = (event) => {
                // only process selection
                if (event.target === this && this.selected) {
                    this.setGroupSelectionOnRootParentTreeItem(this);
                }
            };
            this.addEventListener('click', this.handleClickOverride);
        }
        connectedCallback() {
            super.connectedCallback();
            this.addEventListener('selected-change', this.handleSelectedChange);
            this.treeView = this.getParentTreeView();
            if (this.treeView && this.selected) {
                this.setGroupSelectionOnRootParentTreeItem(this);
            }
        }
        disconnectedCallback() {
            super.disconnectedCallback();
            this.removeEventListener('click', this.handleClickOverride);
            this.removeEventListener('selected-change', this.handleSelectedChange);
            this.treeView = null;
        }
        hasChildTreeItems() {
            const treeItemChild = this.querySelector('[role="treeitem"]');
            return treeItemChild !== null;
        }
        clearTreeGroupSelection() {
            const currentGroupSelection = this.treeView.querySelectorAll(`[${groupSelectedAttribute}]`);
            currentGroupSelection.forEach(treeItem => treeItem.removeAttribute(groupSelectedAttribute));
        }
        setGroupSelectionOnRootParentTreeItem(treeItem) {
            this.clearTreeGroupSelection();
            let currentItem = treeItem;
            while (currentItem.parentElement !== this.treeView) {
                currentItem = currentItem.parentElement;
            }
            if (currentItem) {
                currentItem.setAttribute(groupSelectedAttribute, 'true');
            }
        }
        getImmediateTreeItem(element) {
            let foundElement = element;
            while (foundElement
                && !(foundElement.getAttribute('role') === 'treeitem')) {
                foundElement = foundElement.parentElement;
            }
            return foundElement;
        }
        /**
         * This was copied directly from the FAST TreeItem implementation
         * @returns the root tree view
         */
        getParentTreeView() {
            const parentNode = this.parentElement.closest("[role='tree']");
            return parentNode;
        }
    }
    const nimbleTreeItem = TreeItem.compose({
        baseName: 'tree-item',
        baseClass: TreeItem$1,
        template: treeItemTemplate,
        styles: styles$1,
        expandCollapseGlyph: arrowExpanderUp16X16.data
    });
    DesignSystem.getOrCreate().withPrefix('nimble').register(nimbleTreeItem());

    const styles = css `
    ${display('flex')}

    :host {
        flex-direction: column;
        align-items: stretch;
        min-width: fit-content;
        font-size: 0;
    }
    :host(${focusVisible}) {
        outline: none;
    }
`;

    /**
     * A function that returns a nimble-tree-view registration for configuring the component with a DesignSystem.
     * Implements {@link @microsoft/fast-foundation#treeViewTemplate}
     *
     *
     * @public
     * @remarks
     * Generates HTML Element: \<nimble-tree-view\>
     *
     */
    class TreeView extends TreeView$1 {
        constructor() {
            super(...arguments);
            this.selectionMode = TreeViewSelectionMode.All;
        }
    }
    __decorate([
        attr({ attribute: 'selection-mode' })
    ], TreeView.prototype, "selectionMode", void 0);
    const nimbleTreeView = TreeView.compose({
        baseName: 'tree-view',
        baseClass: TreeView$1,
        template: treeViewTemplate,
        styles
    });
    DesignSystem.getOrCreate().withPrefix('nimble').register(nimbleTreeView());

})();
//# sourceMappingURL=all-components-bundle.js.map