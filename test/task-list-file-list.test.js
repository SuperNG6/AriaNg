'use strict';

const assert = require('assert');
const fs = require('fs');
const htmlMinifier = require('html-minifier');
const vm = require('vm');

const read = (path) => fs.readFileSync(path, 'utf8');

const tests = [];
const test = (name, fn) => tests.push({name, fn});

const assertValidAngularInterpolations = function (source, label) {
    let offset = 0;
    let start;

    while ((start = source.indexOf('{{', offset)) !== -1) {
        const end = source.indexOf('}}', start + 2);
        assert(end !== -1, label + ' has an unterminated Angular interpolation near offset ' + start);

        const expression = source.substring(start + 2, end);
        const stack = [];
        let quote = null;
        let escaped = false;

        for (let index = 0; index < expression.length; index++) {
            const character = expression[index];

            if (quote) {
                if (escaped) {
                    escaped = false;
                } else if (character === '\\') {
                    escaped = true;
                } else if (character === quote) {
                    quote = null;
                }
                continue;
            }

            if (character === '\'' || character === '"') {
                quote = character;
            } else if (character === '(' || character === '[' || character === '{') {
                stack.push(character);
            } else if (character === ')' || character === ']' || character === '}') {
                const expected = character === ')' ? '(' : (character === ']' ? '[' : '{');
                assert.strictEqual(stack.pop(), expected,
                    label + ' has an unbalanced Angular interpolation near offset ' + start);
            }
        }

        assert.strictEqual(quote, null,
            label + ' has an unterminated string in an Angular interpolation near offset ' + start);
        assert.strictEqual(stack.length, 0,
            label + ' has an unbalanced Angular interpolation near offset ' + start);
        offset = end + 2;
    }
};

const loadConstants = function () {
    const constants = {};
    const module = {
        constant: function (name, value) {
            constants[name] = value;
            return module;
        }
    };

    vm.runInNewContext(read('src/scripts/config/constants.js'), {
        angular: {
            module: function () {
                return module;
            }
        }
    });

    return constants;
};

const loadSettingService = function (storedOptions) {
    let factoryDefinition;
    let savedOptions = storedOptions;
    const constants = loadConstants();
    const module = {
        factory: function (name, definition) {
            factoryDefinition = definition;
            return module;
        }
    };
    const angular = {
        module: function () {
            return module;
        },
        isArray: Array.isArray,
        isDefined: function (value) {
            return typeof value !== 'undefined';
        },
        isUndefined: function (value) {
            return typeof value === 'undefined';
        },
        isFunction: function (value) {
            return typeof value === 'function';
        },
        extend: function (target) {
            for (let i = 1; i < arguments.length; i++) {
                Object.assign(target, arguments[i]);
            }
            return target;
        }
    };

    vm.runInNewContext(read('src/scripts/services/ariaNgSettingService.js'), {
        angular: angular,
        console: console
    });

    const dependencies = {
        '$window': {navigator: {language: 'en'}},
        '$location': {
            protocol: function () { return 'http'; },
            host: function () { return 'localhost'; }
        },
        '$filter': function () {},
        'ariaNgConstants': constants.ariaNgConstants,
        'ariaNgDefaultOptions': constants.ariaNgDefaultOptions,
        'ariaNgLanguages': {en: {aliases: ['en']}},
        'ariaNgCommonService': {
            base64Decode: function (value) { return value; },
            generateUniqueId: function () { return 'test-id'; }
        },
        'ariaNgLogService': {info: function () {}, warn: function () {}},
        'ariaNgStorageService': {
            isLocalStorageSupported: function () { return true; },
            isCookiesSupported: function () { return false; },
            get: function () { return savedOptions; },
            set: function (key, value) {
                savedOptions = value;
                return true;
            },
            clearAll: function () {}
        }
    };
    const names = factoryDefinition.slice(0, -1);
    const factory = factoryDefinition[factoryDefinition.length - 1];
    const service = factory.apply(null, names.map(function (name) {
        return dependencies[name];
    }));

    return {
        service: service,
        getSavedOptions: function () { return savedOptions; }
    };
};

const loadListController = function (route, options) {
    options = options || {};
    if (options.bulkStatus && typeof options.bulkStatus.completionId !== 'number') {
        options.bulkStatus.completionId = 0;
    }
    let controllerDefinition;
    let now = 0;
    let intervalCallback;
    let nextTasks;
    let nextTaskListResponse;
    let deferNextRequest = !!options.deferInitialRequest;
    const requests = [];
    const processCalls = [];
    const bulkPreviewCalls = [];
    const bulkEnqueues = [];
    const confirms = [];
    const errors = [];
    const timeoutHandles = [];
    const thresholdSaves = [];
    const listeners = {};
    const watchers = [];
    const fullTask = {
        gid: 'gid-1',
        status: 'active',
        totalLength: '200',
        completedLength: '20',
        files: [{index: '1', path: '/downloads/a.bin', length: '200', completedLength: '20', selected: 'true'}],
        bittorrent: {mode: 'multi', info: {name: 'bundle'}}
    };
    const basicTask = {
        gid: 'gid-1',
        status: 'active',
        totalLength: '200',
        completedLength: '40'
    };
    const module = {
        controller: function (name, definition) {
            controllerDefinition = definition;
            return module;
        }
    };
    const angular = {
        module: function () { return module; },
        element: function () { return {attr: function () {}, index: function () { return 0; }}; },
        isUndefined: function (value) { return typeof value === 'undefined'; },
        extend: function (target, source) { return Object.assign(target, source); }
    };
    const rootScope = {
        taskContext: {list: []},
        keydownActions: {}
    };
    const scope = {
        $on: function (name, callback) { listeners[name] = callback; },
        $watch: function (expression, callback) {
            const path = expression.split('.');
            const readValue = function () {
                let value = scope;
                path.forEach(function (part) { value = value && value[part]; });
                return value;
            };
            const watcher = {read: readValue, callback: callback, last: readValue()};
            watchers.push(watcher);
            return function () {
                const index = watchers.indexOf(watcher);
                if (index >= 0) {
                    watchers.splice(index, 1);
                }
            };
        },
        $apply: function (callback) { callback(); },
        selectAllTasks: function () {},
        removeTasks: function () {}
    };
    if (options.sharedFilterContext) {
        scope.btFileFilterContext = options.sharedFilterContext;
    }
    const commonService = {
        parseOrderType: function () { return {type: 'default', equals: function () { return true; }, getValue: function () { return 'default'; }}; },
        extendArray: function (source, target, key) {
            if (!source || !target || source.length !== target.length) {
                return false;
            }

            for (let i = 0; i < target.length; i++) {
                if (source[i][key] !== target[i][key]) {
                    return false;
                }

                Object.assign(target[i], source[i]);
            }

            return true;
        },
        confirm: function (title, text, type, callback, notClose, settings) {
            confirms.push({title: title, text: text, type: type, settings: settings, callback: callback});
            if (!options.deferConfirm) {
                callback();
            }
        },
        showError: function (message) { errors.push(message); }
    };
    const settingService = {
        getShowFileListInTaskListPage: function () { return true; },
        getDownloadTaskRefreshInterval: function () {
            return typeof options.refreshInterval === 'number' ? options.refreshInterval : 1000;
        },
        getDisplayOrder: function () { return 'default'; },
        getFileListDisplayOrder: function () { return 'default'; },
        setFileListDisplayOrder: function () {},
        getDragAndDropTasks: function () { return false; },
        getBtFileFilterMinSizeMb: function () { return 100; },
        setBtFileFilterMinSizeMb: function (value) { thresholdSaves.push(value); }
    };
    const taskService = {
        getTaskList: function (location, full, callback) {
            const tasks = nextTasks || [JSON.parse(JSON.stringify(full ? fullTask : basicTask))];
            nextTasks = null;
            const request = {
                time: now,
                location: location,
                full: full,
                respond: function () {
                    const response = nextTaskListResponse || {
                        success: true,
                        context: {requestWholeInfo: full},
                        data: tasks
                    };
                    nextTaskListResponse = null;
                    callback(response);
                }
            };
            requests.push(request);

            if (deferNextRequest) {
                deferNextRequest = false;
            } else {
                request.respond();
            }
        },
        processDownloadTasks: function (tasks, addVirtualFileNode) {
            processCalls.push({time: now, addVirtualFileNode: addVirtualFileNode, tasks: tasks});
            tasks.forEach(function (task) {
                task.hasTaskName = true;
                if (addVirtualFileNode && task.files) {
                    task.multiDir = true;
                }
            });
        }
    };

    vm.runInNewContext(read('src/scripts/controllers/list.js'), {
        angular: angular,
        console: console
    });

    const dependencies = {
        '$rootScope': rootScope,
        '$scope': scope,
        '$window': {Date: {now: function () { return now; }}},
        '$location': {path: function () { return '/' + route; }},
        '$route': {},
        '$interval': Object.assign(function (callback) {
            intervalCallback = callback;
            return {};
        }, {cancel: function () {}}),
        '$timeout': Object.assign(function (callback, delay) {
            const handle = {callback: callback, delay: delay, cancelled: false};
            timeoutHandles.push(handle);
            return handle;
        }, {
            cancel: function (handle) { handle.cancelled = true; }
        }),
        'dragulaService': {options: function () {}},
        'aria2RpcErrors': {Unauthorized: {message: 'Unauthorized'}},
        'ariaNgCommonService': commonService,
        'ariaNgSettingService': settingService,
        'ariaNgBtFileFilterService': {
            getPendingGidStageMap: function () { return options.stageMap || {}; },
            getBulkStatus: function () { return options.bulkStatus || {type: 'idle', visible: false}; },
            getBulkPreview: function (tasks, thresholdBytes) {
                bulkPreviewCalls.push({tasks: tasks, thresholdBytes: thresholdBytes});
                return {gids: ['gid-1'], taskCount: 1, fileCount: 1};
            },
            enqueueBulk: function (gids, thresholdBytes) {
                bulkEnqueues.push({gids: Array.from(gids), thresholdBytes: thresholdBytes});
                return options.enqueueBulkResult !== false;
            }
        },
        'aria2TaskService': taskService
    };
    const names = controllerDefinition.slice(0, -1);
    const controller = controllerDefinition[controllerDefinition.length - 1];
    controller.apply(null, names.map(function (name) { return dependencies[name]; }));

    return {
        requests: requests,
        processCalls: processCalls,
        bulkPreviewCalls: bulkPreviewCalls,
        bulkEnqueues: bulkEnqueues,
        confirms: confirms,
        errors: errors,
        thresholdSaves: thresholdSaves,
        rootScope: rootScope,
        scope: scope,
        tick: function (milliseconds) {
            now += milliseconds;
            intervalCallback();
        },
        setTime: function (milliseconds) {
            now = milliseconds;
        },
        digest: function () {
            watchers.slice().forEach(function (watcher) {
                const value = watcher.read();
                if (value !== watcher.last) {
                    const oldValue = watcher.last;
                    watcher.last = value;
                    watcher.callback(value, oldValue);
                }
            });
        },
        flushTimeouts: function () {
            timeoutHandles.forEach(function (handle) {
                if (!handle.cancelled) {
                    handle.cancelled = true;
                    handle.callback();
                }
            });
        },
        toggle: function (enabled) {
            settingService.getShowFileListInTaskListPage = function () { return enabled; };
            listeners['task-list-file-list-mode.changed']({}, enabled);
        },
        deferNextRequest: function () { deferNextRequest = true; },
        resolveRequest: function (index) { requests[index].respond(); },
        setNextTasks: function (tasks) { nextTasks = tasks; },
        setNextTaskListResponse: function (response) { nextTaskListResponse = response; },
        trigger: function (name) { listeners[name]({}); }
    };
};

test('defines the generic task-list preference with a false default', function () {
    const constants = loadConstants();

    assert.strictEqual(constants.ariaNgDefaultOptions.showFileListInTaskListPage, false);
    assert.strictEqual(constants.ariaNgDefaultOptions.showFileListInDownloadingPage, undefined);
});

test('migrates the previous downloading preference', function () {
    const context = loadSettingService({language: 'en', showFileListInDownloadingPage: true});

    assert.strictEqual(context.service.getShowFileListInTaskListPage(), true);
    assert.strictEqual(context.getSavedOptions().showFileListInTaskListPage, true);
});

test('prefers an existing generic preference over the legacy value', function () {
    const context = loadSettingService({
        language: 'en',
        showFileListInDownloadingPage: true,
        showFileListInTaskListPage: false
    });

    assert.strictEqual(context.service.getShowFileListInTaskListPage(), false);
});

test('persists the generic preference without changing the legacy value', function () {
    const context = loadSettingService({language: 'en', showFileListInDownloadingPage: false});

    context.service.setShowFileListInTaskListPage(true);

    assert.strictEqual(context.getSavedOptions().showFileListInTaskListPage, true);
    assert.strictEqual(context.getSavedOptions().showFileListInDownloadingPage, false);
});

test('exposes one toolbar toggle on all task-list routes', function () {
    const main = read('src/scripts/controllers/main.js');
    const index = read('src/index.html');

    assert(main.includes("location === 'downloading' || location === 'waiting' || location === 'stopped'"));
    assert(main.includes('$scope.isTaskListPage = function'));
    assert(main.includes('$scope.isTaskListFileListEnabled = function'));
    assert(main.includes('$scope.toggleTaskListFileList = function'));
    assert(main.includes("$rootScope.$broadcast('task-list-file-list-mode.changed'"));
    assert(index.includes('ng-if="isTaskListPage()"'));
    assert(index.includes('ng-click="toggleTaskListFileList()"'));
});

test('throttles active file details while retaining one-second basic progress', function () {
    const context = loadListController('downloading');

    context.tick(1000);
    context.tick(1000);
    context.tick(1000);
    context.tick(1000);
    context.tick(1000);

    assert.deepStrictEqual(context.requests.map(function (request) { return request.full; }), [true, false, false, false, false, true]);
    assert.deepStrictEqual(context.requests.map(function (request) { return request.time; }), [0, 1000, 2000, 3000, 4000, 5000]);
});

test('does not let basic refreshes overtake a pending file detail refresh', function () {
    const context = loadListController('downloading');

    context.deferNextRequest();
    context.tick(5000);
    context.tick(1000);

    assert.deepStrictEqual(context.requests.map(function (request) { return request.full; }), [true, true]);

    context.resolveRequest(1);
    context.tick(1000);

    assert.deepStrictEqual(context.requests.map(function (request) { return request.full; }), [true, true, false]);
});

test('recovers refreshing when a pending file detail response is never delivered', function () {
    const context = loadListController('downloading');

    // Simulate a lost RPC response (e.g. WebSocket closed with auto-reconnect
    // disabled): the second full request is issued but its callback never fires.
    context.deferNextRequest();
    context.tick(5000);
    context.tick(1000);

    assert.deepStrictEqual(context.requests.map(function (request) { return request.full; }), [true, true]);

    // While the pending request is still within the timeout window, later ticks
    // stay blocked so a basic refresh cannot overtake the pending full request.
    context.tick(20000);
    assert.strictEqual(context.requests.length, 2);

    // Once the pending request is older than the timeout, refreshing recovers on
    // its own without waiting for the lost callback.
    context.tick(10000);
    assert.strictEqual(context.requests.length, 3);
    assert.strictEqual(context.requests[2].full, true);
});

test('does not rebuild active virtual file trees on basic ticks', function () {
    const context = loadListController('downloading');
    const initialFiles = context.rootScope.taskContext.list[0].files;

    context.tick(1000);
    context.tick(1000);

    assert.strictEqual(context.rootScope.taskContext.list[0].files, initialFiles);
    assert.strictEqual(context.processCalls.filter(function (call) { return call.addVirtualFileNode; }).length, 1);
});

test('refreshes active file details immediately when Files mode is enabled', function () {
    const context = loadListController('downloading');

    context.toggle(false);
    context.tick(1000);
    context.toggle(true);

    assert.strictEqual(context.requests[context.requests.length - 1].full, true);
    assert.strictEqual(context.requests[context.requests.length - 1].time, 1000);
});

test('refreshes active file details immediately after the wall clock moves backward', function () {
    const context = loadListController('downloading');

    context.setTime(5000);
    context.tick(0);
    context.setTime(1000);
    context.tick(1000);

    assert.deepStrictEqual(context.requests.map(function (request) { return request.full; }), [true, true, true]);
    assert.deepStrictEqual(context.requests.map(function (request) { return request.time; }), [0, 5000, 2000]);
});

test('does not add periodic full refreshes to waiting and stopped pages', function () {
    ['waiting', 'stopped'].forEach(function (route) {
        const context = loadListController(route);

        for (let i = 0; i < 6; i++) {
            context.tick(1000);
        }

        assert.deepStrictEqual(context.requests.map(function (request) { return request.full; }), [true, false, false, false, false, false, false]);
    });
});

test('requests full details after a basic tick detects task-set changes', function () {
    const context = loadListController('downloading');

    context.setNextTasks([]);
    context.tick(1000);
    context.tick(1000);

    assert.deepStrictEqual(context.requests.map(function (request) { return request.full; }), [true, false, true]);
});

test('requests full details after a same-length task replacement', function () {
    const context = loadListController('downloading');

    context.setNextTasks([{gid: 'gid-2', status: 'active', totalLength: '300', completedLength: '30'}]);
    context.tick(1000);
    context.tick(1000);

    assert.deepStrictEqual(context.requests.map(function (request) { return request.full; }), [true, false, true]);
});

test('shows the bulk BT filter rail only on Downloading while Files mode is open', function () {
    const downloading = loadListController('downloading');
    const waiting = loadListController('waiting');

    assert.strictEqual(downloading.scope.showBulkBtFilterAction(), true);
    assert.strictEqual(waiting.scope.showBulkBtFilterAction(), false);
    downloading.toggle(false);
    assert.strictEqual(downloading.scope.showBulkBtFilterAction(), false);
});

test('caches one bulk preview per full response instead of scanning in the template', function () {
    const context = loadListController('downloading');

    assert.strictEqual(context.bulkPreviewCalls.length, 1);
    assert.strictEqual(context.bulkPreviewCalls[0].thresholdBytes, 100 * 1024 * 1024);
    assert.strictEqual(context.scope.bulkBtFilterPreview.taskCount, 1);
    assert.strictEqual(context.scope.bulkBtFilterPreview.fileCount, 1);

    context.tick(1000);
    assert.strictEqual(context.bulkPreviewCalls.length, 1);
    assert(read('src/scripts/services/aria2RpcService.js').includes("requestParams.push('following')"));
});

test('clears rendered filter badges immediately when the filter service stops', function () {
    const stageMap = {'gid-1': 'applying-filter'};
    const context = loadListController('downloading', {stageMap: stageMap});
    assert.strictEqual(context.rootScope.taskContext.list[0].btFilterStage, 'applying-filter');

    delete stageMap['gid-1'];
    context.trigger('bt-file-filter.stopped');

    assert.strictEqual(context.rootScope.taskContext.list[0].btFilterStage, undefined);
});

test('confirms and submits the cached bulk GID snapshot once', function () {
    const context = loadListController('downloading');

    context.scope.startBulkBtFileFilter();

    assert.strictEqual(context.confirms.length, 1);
    assert.strictEqual(context.confirms[0].type, 'warning');
    assert.deepStrictEqual(context.bulkEnqueues, [{gids: ['gid-1'], thresholdBytes: 100 * 1024 * 1024}]);
});

test('does not submit bulk filtering with an invalid threshold', function () {
    const context = loadListController('downloading');
    context.scope.bulkBtFilterContext.minSizeMb = 'bad';

    context.scope.startBulkBtFileFilter();

    assert.deepStrictEqual(context.confirms, []);
    assert.deepStrictEqual(context.bulkEnqueues, []);
});

test('shares the BT threshold with MainController and debounces preview rescans', function () {
    const shared = {enabled: true, minSizeMb: 100};
    const context = loadListController('downloading', {sharedFilterContext: shared});

    assert.strictEqual(context.scope.bulkBtFilterContext, shared);
    context.scope.bulkBtFilterContext.minSizeMb = 200;
    context.scope.changeBulkBtFileFilterThreshold();
    context.scope.bulkBtFilterContext.minSizeMb = 250;
    context.scope.changeBulkBtFileFilterThreshold();

    assert.strictEqual(shared.minSizeMb, 250);
    assert.deepStrictEqual(context.thresholdSaves, [200, 250]);
    assert.strictEqual(context.bulkPreviewCalls.length, 1);
    context.scope.startBulkBtFileFilter();
    assert.deepStrictEqual(context.confirms, []);

    context.flushTimeouts();
    assert.strictEqual(context.bulkPreviewCalls.length, 2);
    assert.strictEqual(context.bulkPreviewCalls[1].thresholdBytes, 250 * 1024 * 1024);
});

test('reports a rejected bulk enqueue after a delayed confirmation', function () {
    const context = loadListController('downloading', {
        deferConfirm: true,
        enqueueBulkResult: false
    });
    context.scope.startBulkBtFileFilter();

    assert.strictEqual(context.confirms.length, 1);
    assert.deepStrictEqual(context.errors, []);
    context.confirms[0].callback();

    assert.strictEqual(context.bulkEnqueues.length, 1);
    assert.deepStrictEqual(context.errors, ['format.bt-file-filter.bulk.enqueue-failed']);
});

test('blocks a stale preview after completion until fresh task details arrive', function () {
    const bulkStatus = {type: 'idle', visible: false};
    const context = loadListController('downloading', {bulkStatus: bulkStatus});
    bulkStatus.type = 'complete';
    bulkStatus.visible = true;

    context.scope.startBulkBtFileFilter();
    assert.deepStrictEqual(context.confirms, []);

    context.tick(5000);
    assert.strictEqual(context.scope.bulkBtFilterPreview.analyzing, false);
    assert.strictEqual(bulkStatus.type, 'complete');
    bulkStatus.type = 'idle';
    bulkStatus.visible = false;
    context.digest();
    context.scope.startBulkBtFileFilter();
    assert.strictEqual(context.confirms.length, 1);
});

test('does not acknowledge completion with a full response requested before completion', function () {
    const bulkStatus = {type: 'idle', visible: false};
    const context = loadListController('downloading', {bulkStatus: bulkStatus});
    context.deferNextRequest();
    context.tick(5000);
    bulkStatus.type = 'complete';
    bulkStatus.visible = true;

    context.resolveRequest(1);
    assert.strictEqual(bulkStatus.type, 'complete');
    context.scope.startBulkBtFileFilter();
    assert.deepStrictEqual(context.confirms, []);

    context.tick(5000);
    assert.strictEqual(context.scope.bulkBtFilterPreview.analyzing, false);
    assert.strictEqual(bulkStatus.type, 'complete');
    bulkStatus.type = 'idle';
    bulkStatus.visible = false;
    context.digest();
    context.scope.startBulkBtFileFilter();
    assert.strictEqual(context.confirms.length, 1);
});

test('does not let an old full response unlock the preview after completion expires', function () {
    const bulkStatus = {type: 'idle', visible: false, completionId: 0};
    const context = loadListController('downloading', {bulkStatus: bulkStatus});
    context.deferNextRequest();
    context.tick(5000);

    bulkStatus.type = 'complete';
    bulkStatus.visible = true;
    bulkStatus.completionId = 1;
    context.digest();
    assert.strictEqual(context.scope.bulkBtFilterPreview.analyzing, true);

    context.deferNextRequest();
    context.flushTimeouts();
    assert.strictEqual(context.requests.length, 3);

    bulkStatus.type = 'idle';
    bulkStatus.visible = false;
    context.digest();
    context.resolveRequest(1);

    assert.strictEqual(context.scope.bulkBtFilterPreview.analyzing, true);
    context.scope.startBulkBtFileFilter();
    assert.deepStrictEqual(context.confirms, []);
});

test('threshold debounce never acknowledges completion from cached task details', function () {
    const bulkStatus = {type: 'running', visible: true};
    const context = loadListController('downloading', {bulkStatus: bulkStatus});
    context.scope.bulkBtFilterContext.minSizeMb = 200;
    context.scope.changeBulkBtFileFilterThreshold();
    context.deferNextRequest();
    bulkStatus.type = 'complete';
    context.digest();

    context.flushTimeouts();

    assert.strictEqual(bulkStatus.type, 'complete');
    assert.strictEqual(context.scope.bulkBtFilterPreview.analyzing, true);
    assert.strictEqual(context.bulkPreviewCalls.length, 1);
    context.scope.startBulkBtFileFilter();
    assert.deepStrictEqual(context.confirms, []);
});

test('requests fresh task details after completion when periodic refresh is disabled', function () {
    const bulkStatus = {type: 'running', visible: true};
    const context = loadListController('downloading', {
        bulkStatus: bulkStatus,
        refreshInterval: 0
    });
    assert.strictEqual(context.requests.length, 1);
    bulkStatus.type = 'complete';

    context.digest();
    context.flushTimeouts();

    assert.strictEqual(context.requests.length, 2);
    assert.strictEqual(context.requests[1].full, true);
    assert.strictEqual(context.scope.bulkBtFilterPreview.analyzing, false);
    assert.strictEqual(bulkStatus.type, 'complete');
});

test('recovers when the initial completion detail request is lost', function () {
    const bulkStatus = {type: 'complete', visible: true, completionId: 1};
    const context = loadListController('downloading', {
        bulkStatus: bulkStatus,
        refreshInterval: 0,
        deferInitialRequest: true
    });

    assert.strictEqual(context.requests.length, 1);
    context.flushTimeouts();
    context.setTime(30001);
    context.flushTimeouts();

    assert.strictEqual(context.requests.length, 2);
    assert.strictEqual(context.requests[1].full, true);
    assert.strictEqual(context.scope.bulkBtFilterPreview.analyzing, false);
    assert.strictEqual(bulkStatus.type, 'complete');
});

test('keeps the completion refresh watchdog after the notice expires', function () {
    const bulkStatus = {type: 'complete', visible: true, completionId: 1};
    const context = loadListController('downloading', {
        bulkStatus: bulkStatus,
        refreshInterval: 0,
        deferInitialRequest: true
    });

    assert.strictEqual(context.requests.length, 1);
    assert.strictEqual(context.scope.bulkBtFilterPreview.analyzing, true);
    context.flushTimeouts();

    bulkStatus.type = 'idle';
    bulkStatus.visible = false;
    context.digest();
    context.setTime(30001);
    context.flushTimeouts();

    assert.strictEqual(context.requests.length, 2);
    assert.strictEqual(context.requests[1].full, true);
});

test('does not schedule bulk completion refreshes outside Downloading', function () {
    const bulkStatus = {type: 'complete', visible: true, completionId: 1};
    const context = loadListController('waiting', {
        bulkStatus: bulkStatus,
        refreshInterval: 0,
        deferInitialRequest: true
    });

    context.setTime(30001);
    context.flushTimeouts();

    assert.strictEqual(context.requests.length, 1);
    assert.strictEqual(bulkStatus.type, 'complete');
});

test('requests fresh details after an invalid completion threshold is corrected', function () {
    const bulkStatus = {type: 'running', visible: true};
    const context = loadListController('downloading', {
        bulkStatus: bulkStatus,
        refreshInterval: 0
    });
    context.scope.bulkBtFilterContext.minSizeMb = 'bad';
    bulkStatus.type = 'complete';
    context.digest();
    context.flushTimeouts();
    assert.strictEqual(bulkStatus.type, 'complete');

    context.scope.bulkBtFilterContext.minSizeMb = 100;
    context.scope.changeBulkBtFileFilterThreshold();
    context.flushTimeouts();
    context.flushTimeouts();

    assert.strictEqual(bulkStatus.type, 'complete');
});

test('recovers completion refresh after an older full response is lost', function () {
    const bulkStatus = {type: 'running', visible: true};
    const context = loadListController('downloading', {
        bulkStatus: bulkStatus,
        refreshInterval: 0
    });
    context.deferNextRequest();
    bulkStatus.type = 'complete';
    bulkStatus.completionId = 1;
    context.digest();
    context.flushTimeouts();
    assert.strictEqual(context.requests.length, 2);

    context.setTime(30001);
    context.flushTimeouts();

    assert.strictEqual(context.requests.length, 3);
    assert.strictEqual(context.requests[2].full, true);
    assert.strictEqual(bulkStatus.type, 'complete');
});

test('cancels a pending completion retry after Unauthorized', function () {
    const bulkStatus = {type: 'running', visible: true, completionId: 0};
    const context = loadListController('downloading', {
        bulkStatus: bulkStatus,
        refreshInterval: 0
    });
    context.deferNextRequest();
    bulkStatus.type = 'complete';
    bulkStatus.completionId = 1;
    context.digest();
    context.flushTimeouts();
    assert.strictEqual(context.requests.length, 2);

    context.setNextTaskListResponse({
        success: false,
        data: {message: 'Unauthorized'}
    });
    context.resolveRequest(1);
    context.setTime(30001);
    context.flushTimeouts();

    assert.strictEqual(context.requests.length, 2);
});

test('a new completion is not blocked by the previous completion retry', function () {
    const bulkStatus = {type: 'running', visible: true, completionId: 0};
    const context = loadListController('downloading', {
        bulkStatus: bulkStatus,
        refreshInterval: 0
    });
    context.deferNextRequest();
    bulkStatus.type = 'complete';
    bulkStatus.completionId = 1;
    context.digest();
    context.flushTimeouts();
    assert.strictEqual(context.requests.length, 2);

    bulkStatus.type = 'idle';
    context.digest();
    bulkStatus.type = 'running';
    context.digest();
    bulkStatus.type = 'complete';
    bulkStatus.completionId = 2;
    context.digest();
    context.flushTimeouts();

    assert.strictEqual(context.requests.length, 3);
    assert.strictEqual(bulkStatus.type, 'complete');
});

test('retries a failed completion refresh until fresh details succeed', function () {
    const bulkStatus = {type: 'running', visible: true};
    const context = loadListController('downloading', {
        bulkStatus: bulkStatus,
        refreshInterval: 0
    });
    bulkStatus.type = 'complete';
    context.digest();
    context.setNextTaskListResponse({
        success: false,
        data: {message: 'temporary failure'}
    });
    context.flushTimeouts();

    assert.strictEqual(bulkStatus.type, 'complete');
    assert.strictEqual(context.requests.length, 2);
    context.setTime(5000);
    context.flushTimeouts();

    assert.strictEqual(context.requests.length, 3);
    assert.strictEqual(bulkStatus.type, 'complete');
});

test('renders the generic nested panel with read-only file controls', function () {
    const view = read('src/views/list.html');
    const styles = [
        read('src/styles/controls/task-table.css'),
        read('src/styles/theme/default.css'),
        read('src/styles/theme/default-dark.css')
    ].join('\n');

    assert(view.includes('has-task-list-file-list'));
    assert(view.includes('task-list-file-list'));
    assert(view.includes('task-list-file-panel'));
    assert(view.includes('showTaskListFileList()'));
    assert(/task_list_node_[^\n]+type="checkbox" disabled/.test(view));
    assert(/task_list_file_[^\n]+type="checkbox" disabled/.test(view));
    assert(styles.includes('.task-list-file-panel'));
    assert(!styles.includes('downloading-file-panel'));
});

test('renders an accessible responsive bulk BT filter rail in both themes', function () {
    const view = read('src/views/list.html');
    const index = read('src/index.html');
    const controls = read('src/styles/controls/task-table.css');
    const light = read('src/styles/theme/default.css');
    const dark = read('src/styles/theme/default-dark.css');

    assert(view.includes('class="bulk-bt-filter-rail"'));
    assert(view.includes('ng-if="showBulkBtFilterAction()"'));
    assert(view.includes('role="status" aria-live="polite"'));
    assert(view.includes('role="progressbar"'));
    assert(view.includes('aria-labelledby="bulk-bt-filter-title"'));
    assert(view.includes('aria-valuetext='));
    assert(index.includes('class="bt-file-filter-status-accessible"'));
    assert(read('src/styles/core/core.css').includes('.main-header .bt-file-filter-status-accessible'));
    assert(view.includes("bulkBtFilterStatus.type !== 'idle'"));
    assert(view.includes("!bulkBtFilterPreview.analyzing && bulkBtFilterStatus.type === 'complete'"));
    assert(view.includes('ng-click="startBulkBtFileFilter()"'));
    assert(view.includes('ng-model="bulkBtFilterContext.minSizeMb"'));
    assert(/ng-if="bulkBtFilterStatus\.type === 'running'"[\s\S]{0,180}ng-value="bulkBtFilterStatus\.thresholdMb"[\s\S]{0,40}disabled/.test(view));
    assert(controls.includes('.bulk-bt-filter-rail'));
    assert(/\.bulk-bt-filter-rail\s*\{[^}]*flex-wrap:\s*wrap;/s.test(controls));
    assert(/\.bulk-bt-filter-controls \.form-control\s*\{[^}]*width:\s*84px;/s.test(controls));
    assert(controls.includes('@media (max-width: 767px)'));
    assert(light.includes('.skin-aria-ng .bulk-bt-filter-rail'));
    assert(dark.includes('.theme-dark.skin-aria-ng .bulk-bt-filter-rail'));

    const stateRule = light.match(/\.skin-aria-ng \.bulk-bt-filter-state\s*\{([^}]+)\}/);
    const railRule = light.match(/\.skin-aria-ng \.bulk-bt-filter-rail\s*\{([^}]+)\}/);
    const color = stateRule[1].match(/color:\s*(#[0-9a-f]{6})/i)[1];
    const background = railRule[1].match(/background-color:\s*(#[0-9a-f]{6})/i)[1];
    const luminance = function (hex) {
        const channels = [1, 3, 5].map(function (offset) {
            const value = parseInt(hex.substr(offset, 2), 16) / 255;
            return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const foreground = luminance(color);
    const surface = luminance(background);
    const contrast = (Math.max(foreground, surface) + 0.05) / (Math.min(foreground, surface) + 0.05);
    assert(contrast >= 4.5, 'bulk status contrast was ' + contrast.toFixed(2) + ':1');
});

test('keeps Angular template interpolations structurally complete', function () {
    const templates = ['src/index.html'].concat(fs.readdirSync('src/views')
        .filter(function (name) { return /\.html$/.test(name); })
        .map(function (name) { return 'src/views/' + name; }));
    templates.forEach(function (path) {
        const source = read(path);
        assertValidAngularInterpolations(source, path);
        assertValidAngularInterpolations(htmlMinifier.minify(source, {collapseWhitespace: true}),
            path + ' after html-minifier');
    });
    assert.throws(function () {
        assertValidAngularInterpolations('<div title="{{value | filter: {count: total}}}"></div>', 'fixture');
    }, /unbalanced Angular interpolation/);
});

test('rebuilds the Angular template cache before reloading the development server', function () {
    const gulpfile = read('gulpfile.js');

    assert(gulpfile.includes("gulp.series('prepare-styles', 'prepare-scripts', 'prepare-fonts', 'prepare-views'"));
    assert(gulpfile.includes("gulp.watch('src/views/**/*.html', gulp.series('prepare-views'"));
    assert(!/src\/views\/\*\.html'[\s\S]{0,120}\.on\('change', reload\)/.test(gulpfile));
});

test('keeps bulk progress visible globally when the contextual rail is hidden', function () {
    const main = read('src/scripts/controllers/main.js');
    const index = read('src/index.html');

    assert(main.includes('$scope.bulkBtFileFilterStatus = ariaNgBtFileFilterService.getBulkStatus()'));
    assert(main.includes('$scope.showBulkBtFileFilterGlobalStatus = function'));
    assert(main.includes("$location.path() === '/downloading' && $scope.isTaskListFileListEnabled()"));
    assert(index.includes('class="bt-file-filter-status bulk-bt-file-filter-global-status"'));
    assert(index.includes('ng-if="showBulkBtFileFilterGlobalStatus()"'));
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
