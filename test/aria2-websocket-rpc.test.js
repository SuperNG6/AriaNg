'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const read = (path) => fs.readFileSync(path, 'utf8');

const tests = [];
const test = (name, fn) => tests.push({name, fn});

const loadWebSocketRpcService = function (reconnectInterval) {
    let factoryDefinition;
    const clients = [];
    const deferreds = [];
    const timeouts = [];
    const module = {
        factory: function (name, definition) {
            assert.strictEqual(name, 'aria2WebSocketRpcService');
            factoryDefinition = definition;
            return module;
        }
    };
    const websocket = function (url, options) {
        const client = {
            url: url,
            options: options,
            readyState: 1,
            sent: [],
            reconnectCount: 0,
            onMessage: function (callback) {
                this.messageCallback = callback;
                return this;
            },
            onOpen: function (callback) {
                this.openCallback = callback;
                return this;
            },
            onClose: function (callback) {
                this.closeCallback = callback;
                return this;
            },
            send: function (message) {
                this.sent.push(message);
            },
            reconnect: function () {
                this.reconnectCount++;
            },
            triggerClose: function (event) {
                this.readyState = 3;
                this.closeCallback(event || {});
            }
        };

        clients.push(client);
        return client;
    };
    const q = {
        defer: function () {
            const deferred = {
                promise: {},
                resolveCount: 0,
                rejectCount: 0,
                resolvedValue: null,
                rejectedValue: null,
                resolve: function (value) {
                    this.resolveCount++;
                    this.resolvedValue = value;
                },
                reject: function (value) {
                    this.rejectCount++;
                    this.rejectedValue = value;
                }
            };

            deferreds.push(deferred);
            return deferred;
        }
    };
    const timeout = function (callback, delay) {
        const handle = {callback: callback, delay: delay};
        timeouts.push(handle);
        return handle;
    };

    vm.runInNewContext(read('src/scripts/services/aria2WebSocketRpcService.js'), {
        angular: {
            module: function () {
                return module;
            },
            fromJson: JSON.parse,
            toJson: JSON.stringify,
            isArray: Array.isArray
        }
    });

    const dependencies = {
        '$q': q,
        '$websocket': websocket,
        '$timeout': timeout,
        'ariaNgConstants': {},
        'ariaNgSettingService': {
            getCurrentRpcUrl: function () { return 'ws://localhost/jsonrpc'; },
            getWebSocketReconnectInterval: function () { return reconnectInterval; }
        },
        'ariaNgLogService': {
            debug: function () {},
            warn: function () {}
        }
    };
    const names = factoryDefinition.slice(0, -1);
    const factory = factoryDefinition[factoryDefinition.length - 1];
    const service = factory.apply(null, names.map(function (name) {
        return dependencies[name];
    }));

    return {
        service: service,
        clients: clients,
        deferreds: deferreds,
        timeouts: timeouts
    };
};

const makeRequest = function (uniqueId, errors) {
    return {
        id: uniqueId,
        uniqueId: uniqueId,
        requestBody: {
            id: uniqueId,
            method: 'aria2.tellStatus'
        },
        errorCallback: function (id, error) {
            errors.push({id: id, error: error});
        }
    };
};

test('rejects disabled-reconnect requests exactly once and never sends to the closed socket', function () {
    const context = loadWebSocketRpcService(0);
    const firstErrors = [];
    const secondErrors = [];
    const laterErrors = [];

    context.service.request(makeRequest('request-1', firstErrors));
    context.service.request(makeRequest('request-2', secondErrors));

    const client = context.clients[0];
    assert.strictEqual(client.sent.length, 2);

    client.triggerClose({code: 1006});

    assert.strictEqual(context.deferreds[0].rejectCount, 1);
    assert.strictEqual(context.deferreds[1].rejectCount, 1);
    assert.strictEqual(firstErrors.length, 1);
    assert.strictEqual(secondErrors.length, 1);
    assert.strictEqual(firstErrors[0].error.message, 'Cannot connect to aria2!');
    assert.strictEqual(secondErrors[0].error.message, 'Cannot connect to aria2!');

    client.triggerClose({code: 1006});

    assert.strictEqual(context.deferreds[0].rejectCount, 1);
    assert.strictEqual(context.deferreds[1].rejectCount, 1);
    assert.strictEqual(firstErrors.length, 1);
    assert.strictEqual(secondErrors.length, 1);

    context.service.request(makeRequest('request-3', laterErrors));

    assert.strictEqual(context.clients.length, 1);
    assert.strictEqual(client.sent.length, 2);
    assert.strictEqual(context.deferreds[2].rejectCount, 1);
    assert.strictEqual(laterErrors.length, 1);
    assert.strictEqual(laterErrors[0].error.message, 'Cannot connect to aria2!');
});

test('keeps auto-reconnect pending requests for the existing reconnect path', function () {
    const context = loadWebSocketRpcService(500);
    const errors = [];

    context.service.request(makeRequest('request-1', errors));

    const client = context.clients[0];
    client.triggerClose({code: 1006});

    assert.strictEqual(context.deferreds[0].rejectCount, 0);
    assert.strictEqual(errors.length, 0);
    assert.strictEqual(context.timeouts.length, 1);
    assert.strictEqual(client.reconnectCount, 0);

    context.timeouts[0].callback();

    assert.strictEqual(context.deferreds[0].rejectCount, 1);
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(client.reconnectCount, 1);
});

let failed = 0;

tests.forEach(function (item) {
    try {
        item.fn();
        console.log('PASS ' + item.name);
    } catch (error) {
        failed++;
        console.error('FAIL ' + item.name);
        console.error(error.stack || error.message);
    }
});

if (failed > 0) {
    console.error(failed + ' test(s) failed');
    process.exit(1);
}

console.log(tests.length + ' test(s) passed');
