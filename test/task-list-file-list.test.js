'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const read = (path) => fs.readFileSync(path, 'utf8');

const tests = [];
const test = (name, fn) => tests.push({name, fn});

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

const loadListController = function (route) {
    let controllerDefinition;
    let now = 0;
    let intervalCallback;
    let nextTasks;
    let deferNextRequest = false;
    const requests = [];
    const processCalls = [];
    const listeners = {};
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
        $apply: function (callback) { callback(); },
        selectAllTasks: function () {},
        removeTasks: function () {}
    };
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
        }
    };
    const settingService = {
        getShowFileListInTaskListPage: function () { return true; },
        getDownloadTaskRefreshInterval: function () { return 1000; },
        getDisplayOrder: function () { return 'default'; },
        getFileListDisplayOrder: function () { return 'default'; },
        setFileListDisplayOrder: function () {},
        getDragAndDropTasks: function () { return false; }
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
                    callback({success: true, context: {requestWholeInfo: full}, data: tasks});
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
        'dragulaService': {options: function () {}},
        'aria2RpcErrors': {Unauthorized: {message: 'Unauthorized'}},
        'ariaNgCommonService': commonService,
        'ariaNgSettingService': settingService,
        'aria2TaskService': taskService
    };
    const names = controllerDefinition.slice(0, -1);
    const controller = controllerDefinition[controllerDefinition.length - 1];
    controller.apply(null, names.map(function (name) { return dependencies[name]; }));

    return {
        requests: requests,
        processCalls: processCalls,
        rootScope: rootScope,
        scope: scope,
        tick: function (milliseconds) {
            now += milliseconds;
            intervalCallback();
        },
        setTime: function (milliseconds) {
            now = milliseconds;
        },
        toggle: function (enabled) {
            settingService.getShowFileListInTaskListPage = function () { return enabled; };
            listeners['task-list-file-list-mode.changed']({}, enabled);
        },
        deferNextRequest: function () { deferNextRequest = true; },
        resolveRequest: function (index) { requests[index].respond(); },
        setNextTasks: function (tasks) { nextTasks = tasks; }
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
