(function () {
    'use strict';

    angular.module('ariaNg').factory('ariaNgBtFileFilterService', ['$interval', '$timeout', 'ariaNgConstants', 'ariaNgStorageService', 'ariaNgSettingService', 'ariaNgNotificationService', 'ariaNgLogService', 'aria2TaskService', function ($interval, $timeout, ariaNgConstants, ariaNgStorageService, ariaNgSettingService, ariaNgNotificationService, ariaNgLogService, aria2TaskService) {
        // 这里协调两种流程：新任务等待元数据后自动过滤；已有任务按固定 GID 队列批量过滤。
        // RPC 成功只表示请求被接收，完成判定必须回读文件选择和选项；不要在写入回调中直接结算。
        // 删除未选文件由 aria2 在完成时执行，本服务不直接删除本地文件。
        var storageKey = ariaNgConstants.btFileFilterQueueStorageKey;
        var bulkStorageKey = ariaNgConstants.btFileFilterBulkQueueStorageKey;
        var bulkProgressStorageKey = ariaNgConstants.btFileFilterBulkProgressStorageKey;
        var storedJobs = ariaNgStorageService.get(storageKey);
        var storedBulkDefinitions = ariaNgStorageService.get(bulkStorageKey);
        var storedBulkProgresses = ariaNgStorageService.get(bulkProgressStorageKey);
        var allowedSourceTypes = ['magnet', 'remote-torrent', 'torrent'];
        var allowedStages = [
            'waiting-metadata', 'waiting-files', 'applying-filter', 'restoring-full',
            'starting-filtered', 'starting-full', 'starting-fallback',
            'completed-filtered', 'completed-full', 'completed-fallback'
        ];
        var missingRootScanLimit = 3;
        var pollingInterval = 250;
        var allowedBulkStages = ['inspecting', 'pausing', 'applying', 'restoring', 'resuming'];
        var bulkMutationRestartDelay = 1000;
        var bulkConvergenceDelay = 1000;
        var bulkMutationRetryLimit = 3;

        var normalizeInteger = function (value, defaultValue) {
            var number = Number(value);
            return isFinite(number) && number >= 0 ? Math.floor(number) : defaultValue;
        };

        // aria2 的文件索引从 1 开始，不能用数组下标替代；持久化恢复时同时去重和剔除非法值。
        var normalizeIndexes = function (value) {
            if (!Array.isArray(value)) {
                return [];
            }

            var indexes = [];
            var seenIndexes = {};
            for (var i = 0; i < value.length; i++) {
                var index = Number(value[i]);
                if (isFinite(index) && index > 0 && index === Math.floor(index) && !seenIndexes[index]) {
                    seenIndexes[index] = true;
                    indexes.push(index);
                }
            }
            return indexes;
        };

        var normalizeBoolean = function (value) {
            if (value === true || value === 'true' || value === 1 || value === '1') {
                return true;
            }
            if (value === false || value === 'false' || value === 0 || value === '0') {
                return false;
            }
            return null;
        };

        var normalizeInfoHash = function (value) {
            var normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
            return /^[0-9a-f]{40}$/.test(normalized) ? normalized : '';
        };

        // 存储是跨版本、跨刷新输入边界，只恢复已知字段和阶段。
        // 自动任务不恢复 verifiedAt：刷新后必须重新观察完整的稳定窗口。
        var sanitizeJob = function (job) {
            if (!job || typeof job !== 'object' || Array.isArray(job)) {
                return null;
            }

            var rpcIdentity = typeof job.rpcIdentity === 'string' ? job.rpcIdentity.trim() : '';
            var rootGid = typeof job.rootGid === 'string' ? job.rootGid.trim() : '';
            var thresholdBytes = Number(job.thresholdBytes);
            var startAfterFilter = normalizeBoolean(job.startAfterFilter);
            if (!rpcIdentity || !rootGid || !isFinite(thresholdBytes) || thresholdBytes <= 0 ||
                startAfterFilter === null || allowedSourceTypes.indexOf(job.sourceType) < 0 ||
                allowedStages.indexOf(job.stage) < 0) {
                return null;
            }

            var timestamp = Date.now();
            var createdAt = Number(job.createdAt);
            var updatedAt = Number(job.updatedAt);
            var sanitized = {
                rpcIdentity: rpcIdentity,
                rootGid: rootGid,
                childGid: typeof job.childGid === 'string' ? job.childGid.trim() : '',
                thresholdBytes: thresholdBytes,
                startAfterFilter: startAfterFilter,
                sourceType: job.sourceType,
                stage: job.stage,
                retryCount: normalizeInteger(job.retryCount, 0),
                originalRemoveUnselectedFile: job.originalRemoveUnselectedFile === null ||
                    typeof job.originalRemoveUnselectedFile === 'undefined' ? null :
                    String(job.originalRemoveUnselectedFile),
                createdAt: isFinite(createdAt) && createdAt > 0 ? createdAt : timestamp,
                updatedAt: isFinite(updatedAt) && updatedAt > 0 ? updatedAt : timestamp,
                missingRootScanCount: normalizeInteger(job.missingRootScanCount, 0),
                terminalChildScanCount: normalizeInteger(job.terminalChildScanCount, 0)
            };

            var selectedIndexes = normalizeIndexes(job.selectedIndexes);
            var allIndexes = normalizeIndexes(job.allIndexes);
            if (selectedIndexes.length > 0) {
                sanitized.selectedIndexes = selectedIndexes;
            }
            if (allIndexes.length > 0) {
                sanitized.allIndexes = allIndexes;
            }
            if (job.restoreAttempted) {
                sanitized.restoreAttempted = true;
            }
            if (job.mutationRequestedAt) {
                sanitized.mutationRequestedAt = normalizeInteger(job.mutationRequestedAt, 0);
            }
            if (job.pauseOwned) {
                sanitized.pauseOwned = true;
            }
            if (job.resumeRequested) {
                sanitized.resumeRequested = true;
            }
            // A reload must establish a new stability window from fresh readbacks.
            if (job.preserveExistingSelection) {
                sanitized.preserveExistingSelection = true;
            }
            if (job.restorationOutcome === 'full' || job.restorationOutcome === 'fallback') {
                sanitized.restorationOutcome = job.restorationOutcome;
            } else if (job.stage === 'restoring-full') {
                sanitized.restorationOutcome = 'fallback';
            }

            var infoHash = normalizeInfoHash(job.infoHash);
            if (infoHash) {
                sanitized.infoHash = infoHash;
            }

            return sanitized;
        };

        var sanitizeQueue = function (value) {
            var sanitized = [];
            if (!Array.isArray(value)) {
                return sanitized;
            }
            for (var i = 0; i < value.length; i++) {
                var job = sanitizeJob(value[i]);
                if (job) {
                    sanitized.push(job);
                }
            }
            return sanitized;
        };

        // 批次定义保存提交时的阈值和任务顺序；后续设置变化不能改变正在执行的批次。
        var sanitizeBulkDefinition = function (definition) {
            if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
                return null;
            }
            var rpcIdentity = typeof definition.rpcIdentity === 'string' ? definition.rpcIdentity.trim() : '';
            var thresholdBytes = Number(definition.thresholdBytes);
            if (!rpcIdentity || !isFinite(thresholdBytes) || thresholdBytes <= 0 ||
                !Array.isArray(definition.gids)) {
                return null;
            }

            var gids = [];
            var seenGids = {};
            for (var i = 0; i < definition.gids.length; i++) {
                var gid = typeof definition.gids[i] === 'string' ? definition.gids[i].trim() : '';
                if (gid && !seenGids[gid]) {
                    seenGids[gid] = true;
                    gids.push(gid);
                }
            }
            if (gids.length < 1) {
                return null;
            }

            return {
                rpcIdentity: rpcIdentity,
                thresholdBytes: thresholdBytes,
                gids: gids,
                createdAt: normalizeInteger(definition.createdAt, Date.now())
            };
        };

        var sanitizeBulkDefinitions = function (value) {
            var sanitized = [];
            if (!Array.isArray(value)) {
                return sanitized;
            }
            for (var i = 0; i < value.length; i++) {
                var definition = sanitizeBulkDefinition(value[i]);
                if (definition && !sanitized.some(function (item) {
                    return item.rpcIdentity === definition.rpcIdentity;
                })) {
                    sanitized.push(definition);
                }
            }
            return sanitized;
        };

        var sanitizeBulkCurrent = function (current) {
            if (!current || typeof current !== 'object' || Array.isArray(current) ||
                typeof current.gid !== 'string' || allowedBulkStages.indexOf(current.stage) < 0) {
                return null;
            }
            var sanitized = {
                gid: current.gid.trim(),
                stage: current.stage,
                retryCount: normalizeInteger(current.retryCount, 0),
                restoreRetryCount: normalizeInteger(current.restoreRetryCount, 0),
                pauseOwned: current.pauseOwned === true || current.stage === 'pausing' ||
                    current.stage === 'resuming',
                mutationRequestedAt: normalizeInteger(current.mutationRequestedAt, 0),
                // 页面离开期间没有连续观察，不能沿用落盘的稳定时间。
                verifiedAt: 0,
                resumeRetryCount: normalizeInteger(current.resumeRetryCount, 0),
                resumeOutcome: current.resumeOutcome === 'filtered' ? 'filtered' : 'failed',
                filteredFileCount: normalizeInteger(current.filteredFileCount, 0)
            };
            if (!sanitized.gid) {
                return null;
            }
            var original = normalizeIndexes(current.originalSelectedIndexes);
            var target = normalizeIndexes(current.targetSelectedIndexes);
            if (original.length > 0) {
                sanitized.originalSelectedIndexes = original;
            }
            if (target.length > 0) {
                sanitized.targetSelectedIndexes = target;
            }
            if (typeof current.originalRemoveUnselectedFile !== 'undefined') {
                sanitized.originalRemoveUnselectedFile = String(current.originalRemoveUnselectedFile);
            }
            if (typeof current.targetRemoveUnselectedFile !== 'undefined') {
                sanitized.targetRemoveUnselectedFile = String(current.targetRemoveUnselectedFile);
            }
            if (sanitized.stage !== 'inspecting' && (!sanitized.originalSelectedIndexes ||
                !sanitized.targetSelectedIndexes ||
                typeof sanitized.originalRemoveUnselectedFile === 'undefined' ||
                typeof sanitized.targetRemoveUnselectedFile === 'undefined')) {
                return null;
            }
            return sanitized;
        };

        // 进度必须匹配批次定义，current 只能对应游标所指任务，避免恢复后重复结算或处理错 GID。
        var sanitizeBulkProgress = function (progress, definitions) {
            if (!progress || typeof progress !== 'object' || Array.isArray(progress) ||
                typeof progress.rpcIdentity !== 'string') {
                return null;
            }
            var definition = null;
            for (var i = 0; i < definitions.length; i++) {
                if (definitions[i].rpcIdentity === progress.rpcIdentity) {
                    definition = definitions[i];
                    break;
                }
            }
            if (!definition) {
                return null;
            }

            var cursor = normalizeInteger(progress.cursor, 0);
            if (cursor > definition.gids.length) {
                cursor = definition.gids.length;
            }
            var sanitized = {
                rpcIdentity: definition.rpcIdentity,
                cursor: cursor,
                processed: normalizeInteger(progress.processed, 0),
                filtered: normalizeInteger(progress.filtered, 0),
                skipped: normalizeInteger(progress.skipped, 0),
                failed: normalizeInteger(progress.failed, 0),
                filteredFiles: normalizeInteger(progress.filteredFiles, 0),
                current: sanitizeBulkCurrent(progress.current)
            };
            if (sanitized.current && (cursor >= definition.gids.length ||
                sanitized.current.gid !== definition.gids[cursor])) {
                sanitized.current = null;
            }
            return sanitized;
        };

        var sanitizeBulkProgresses = function (value, definitions) {
            var sanitized = [];
            if (!Array.isArray(value)) {
                return sanitized;
            }
            for (var i = 0; i < value.length; i++) {
                var progress = sanitizeBulkProgress(value[i], definitions);
                if (progress && !sanitized.some(function (item) {
                    return item.rpcIdentity === progress.rpcIdentity;
                })) {
                    sanitized.push(progress);
                }
            }
            return sanitized;
        };

        var jobs = sanitizeQueue(storedJobs);
        var bulkDefinitions = sanitizeBulkDefinitions(storedBulkDefinitions);
        var bulkProgresses = sanitizeBulkProgresses(storedBulkProgresses, bulkDefinitions);
        // 定义与进度分两次落盘；没有进度的定义属于未完成提交，不作为可恢复批次执行。
        bulkDefinitions = bulkDefinitions.filter(function (definition) {
            return bulkProgresses.some(function (progress) {
                return progress.rpcIdentity === definition.rpcIdentity;
            });
        });
        var serializedStoredJobs;
        var serializedJobs = JSON.stringify(jobs);
        try {
            serializedStoredJobs = JSON.stringify(storedJobs);
        } catch (error) {
            serializedStoredJobs = null;
        }
        if (serializedStoredJobs !== serializedJobs) {
            ariaNgStorageService.set(storageKey, jobs);
        }
        if (JSON.stringify(storedBulkDefinitions) !== JSON.stringify(bulkDefinitions)) {
            ariaNgStorageService.set(bulkStorageKey, bulkDefinitions);
        }
        if (JSON.stringify(storedBulkProgresses) !== JSON.stringify(bulkProgresses)) {
            ariaNgStorageService.set(bulkProgressStorageKey, bulkProgresses);
        }
        var status = {
            visible: false,
            type: 'idle',
            total: 0,
            processed: 0,
            waiting: 0,
            filtered: 0,
            full: 0,
            fallback: 0,
            textKey: '',
            textParams: {}
        };
        var bulkStatus = {
            visible: false,
            type: 'idle',
            completionId: 0,
            currentGid: '',
            currentStage: '',
            thresholdBytes: 0,
            thresholdMb: 0,
            total: 0,
            processed: 0,
            filtered: 0,
            skipped: 0,
            failed: 0,
            filteredFiles: 0
        };
        var bulkStatusRpcIdentity = null;
        var bulkStatusVersion = 0;
        var pollingPromise = null;
        // 唯一的在途锁保存操作对象而非布尔值；旧回调只能释放自己的锁，不能解锁新一轮工作。
        var activeOperation = null;
        // stop/start 后让旧生命周期的回调失效；RPC 身份检查另行隔离不同服务器。
        var lifecycleGeneration = 0;
        var restoredQueue = jobs.length > 0;
        var activeRpcIdentity = null;
        var pollCursor = 0;
        var automaticJobTurn = true;
        var statusVersion = 0;
        var aggregate = {
            total: 0,
            processed: 0,
            filtered: 0,
            full: 0,
            fallback: 0
        };

        // 只看 URL 路径的 torrent 后缀，查询参数中的文件名不能把普通下载误判成元数据任务。
        var isBtMetadataUrl = function (url) {
            var normalized = String(url || '').trim();
            if (/^magnet:\?/i.test(normalized)) {
                return true;
            }

            var urlWithoutQueryOrFragment = normalized.split(/[?#]/)[0];
            return /^https?:\/\/[^/?#]+\/.*\.torrent$/i.test(urlWithoutQueryOrFragment);
        };

        // 新任务没有可保留的大文件时回退为全选，避免提交空 select-file。
        var planFiles = function (files, thresholdBytes) {
            var selectedIndexes = [];
            var allIndexes = [];

            for (var i = 0; i < files.length; i++) {
                var index = parseInt(files[i].index);
                var length = parseInt(files[i].length);
                allIndexes.push(index);
                if (length >= thresholdBytes) {
                    selectedIndexes.push(index);
                }
            }

            var mode = 'filter';
            if (selectedIndexes.length < 1) {
                mode = 'all-small';
            } else if (selectedIndexes.length === allIndexes.length) {
                mode = 'all-large';
            }

            return {
                mode: mode,
                selectedIndexes: selectedIndexes,
                allIndexes: allIndexes
            };
        };

        // 列表展示可能混入虚拟目录；过滤计划只接受具有合法 aria2 索引和长度的真实文件。
        var getRealFiles = function (files) {
            var realFiles = [];
            if (!Array.isArray(files)) {
                return realFiles;
            }

            for (var i = 0; i < files.length; i++) {
                var index = Number(files[i].index);
                var length = Number(files[i].length);
                if (!files[i].isDir && isFinite(index) && index > 0 && index === Math.floor(index) &&
                    isFinite(length) && length >= 0) {
                    realFiles.push(files[i]);
                }
            }
            return realFiles;
        };

        var isBtPayloadTask = function (task) {
            return !!(task && task.seeder !== true && String(task.seeder) !== 'true' &&
                typeof task.verifiedLength === 'undefined' &&
                String(task.verifyIntegrityPending) !== 'true' &&
                normalizeInfoHash(task.infoHash) && task.bittorrent && task.bittorrent.info &&
                getRealFiles(task.files).length > 0);
        };

        var isActiveBtPayloadTask = function (task) {
            return !!(task && task.status === 'active' && isBtPayloadTask(task));
        };

        // 已有任务只从当前已选文件中缩小范围，保留用户手动排除项；全小文件时保持原选择。
        var planExistingTaskFiles = function (files, thresholdBytes) {
            var originalSelectedIndexes = [];
            var targetSelectedIndexes = [];
            var allIndexes = [];

            for (var i = 0; Array.isArray(files) && i < files.length; i++) {
                var index = Number(files[i].index);
                var length = Number(files[i].length);
                if (files[i].isDir || !isFinite(index) || index <= 0 || index !== Math.floor(index) ||
                    !isFinite(length) || length < 0) {
                    continue;
                }
                var selected = String(files[i].selected) === 'true';
                allIndexes.push(index);
                if (selected) {
                    originalSelectedIndexes.push(index);
                    if (length >= thresholdBytes) {
                        targetSelectedIndexes.push(index);
                    }
                }
            }

            var mode = 'unchanged';
            if (originalSelectedIndexes.length > 0 && targetSelectedIndexes.length === 0) {
                mode = 'all-small';
            } else if (targetSelectedIndexes.length > 0 &&
                targetSelectedIndexes.length < originalSelectedIndexes.length) {
                mode = 'filter';
            }

            return {
                mode: mode,
                originalSelectedIndexes: originalSelectedIndexes,
                targetSelectedIndexes: targetSelectedIndexes,
                allIndexes: allIndexes,
                filteredFileCount: originalSelectedIndexes.length - targetSelectedIndexes.length,
                realFileCount: allIndexes.length
            };
        };

        // 自动流程同时拥有元数据根任务和已接管的子任务，批量流程必须避让二者。
        var getAutomaticOwnedGids = function (rpcIdentity) {
            var automaticGids = {};
            for (var jobIndex = 0; jobIndex < jobs.length; jobIndex++) {
                if (jobs[jobIndex].rpcIdentity !== rpcIdentity || isTerminalJob(jobs[jobIndex])) {
                    continue;
                }
                automaticGids[jobs[jobIndex].rootGid] = true;
                if (jobs[jobIndex].childGid) {
                    automaticGids[jobs[jobIndex].childGid] = true;
                }
            }
            return automaticGids;
        };

        var isTaskOwnedByAutomaticJob = function (task, automaticGids) {
            return !!task && (!!automaticGids[task.gid] || !!automaticGids[task.following]);
        };

        // 预览由控制器缓存，不在模板 digest 中反复计算。这里先做轻量资格检查，再由规划器遍历文件。
        var getBulkPreview = function (tasks, thresholdBytes) {
            var gids = [];
            var fileCount = 0;
            var automaticGids = getAutomaticOwnedGids(getCurrentRpcIdentity());
            if (!Array.isArray(tasks) || !isFinite(thresholdBytes) || thresholdBytes <= 0) {
                return {gids: gids, taskCount: 0, fileCount: 0};
            }

            for (var i = 0; i < tasks.length; i++) {
                var task = tasks[i];
                if (!task || isTaskOwnedByAutomaticJob(task, automaticGids) ||
                    task.status !== 'active' || task.seeder === true ||
                    String(task.seeder) === 'true' || typeof task.verifiedLength !== 'undefined' ||
                    String(task.verifyIntegrityPending) === 'true' || !normalizeInfoHash(task.infoHash) ||
                    !task.bittorrent || !task.bittorrent.info) {
                    continue;
                }
                var plan = planExistingTaskFiles(task.files, thresholdBytes);
                if (plan.mode === 'filter') {
                    gids.push(task.gid);
                    fileCount += plan.filteredFileCount;
                }
            }

            return {gids: gids, taskCount: gids.length, fileCount: fileCount};
        };

        var saveJobs = function () {
            ariaNgStorageService.set(storageKey, jobs);
        };

        var saveBulkDefinitions = function () {
            return ariaNgStorageService.set(bulkStorageKey, bulkDefinitions);
        };

        var saveBulkProgresses = function () {
            return ariaNgStorageService.set(bulkProgressStorageKey, bulkProgresses);
        };

        var findBulkDefinition = function (rpcIdentity) {
            for (var i = 0; i < bulkDefinitions.length; i++) {
                if (bulkDefinitions[i].rpcIdentity === rpcIdentity) {
                    return bulkDefinitions[i];
                }
            }
            return null;
        };

        var findBulkProgress = function (rpcIdentity) {
            for (var i = 0; i < bulkProgresses.length; i++) {
                if (bulkProgresses[i].rpcIdentity === rpcIdentity) {
                    return bulkProgresses[i];
                }
            }
            return null;
        };

        var setBulkIdleStatus = function () {
            bulkStatusVersion++;
            bulkStatus.visible = false;
            bulkStatus.type = 'idle';
            bulkStatus.currentGid = '';
            bulkStatus.currentStage = '';
            bulkStatus.thresholdBytes = 0;
            bulkStatus.thresholdMb = 0;
            bulkStatus.total = 0;
            bulkStatus.processed = 0;
            bulkStatus.filtered = 0;
            bulkStatus.skipped = 0;
            bulkStatus.failed = 0;
            bulkStatus.filteredFiles = 0;
        };

        var updateBulkRunningStatus = function () {
            var rpcIdentity = getCurrentRpcIdentity();
            var definition = findBulkDefinition(rpcIdentity);
            var progress = findBulkProgress(rpcIdentity);
            if (!definition || !progress) {
                if (bulkStatus.type !== 'complete') {
                    setBulkIdleStatus();
                }
                return;
            }

            bulkStatus.visible = true;
            bulkStatusVersion++;
            bulkStatus.type = 'running';
            bulkStatus.currentGid = progress.current ? progress.current.gid : '';
            bulkStatus.currentStage = progress.current ? progress.current.stage : '';
            bulkStatus.thresholdBytes = definition.thresholdBytes;
            bulkStatus.thresholdMb = definition.thresholdBytes / 1024 / 1024;
            bulkStatus.total = definition.gids.length;
            bulkStatus.processed = progress.processed;
            bulkStatus.filtered = progress.filtered;
            bulkStatus.skipped = progress.skipped;
            bulkStatus.failed = progress.failed;
            bulkStatus.filteredFiles = progress.filteredFiles;
        };

        var isTerminalJob = function (job) {
            return job.stage.indexOf('completed-') === 0;
        };

        var getCurrentRpcIdentity = function () {
            return ariaNgSettingService.getCurrentRpcIdentity();
        };

        // 每条异步 RPC 链捕获连接身份和生命周期，后续回调不得读取新连接并冒充原操作继续执行。
        var createOperationContext = function (rpcIdentity) {
            return {
                rpcIdentity: rpcIdentity,
                generation: lifecycleGeneration
            };
        };

        var isOperationCurrent = function (operation) {
            return !!(operation && typeof operation === 'object' &&
                operation.generation === lifecycleGeneration &&
                operation.rpcIdentity === getCurrentRpcIdentity());
        };

        var getCurrentRecords = function () {
            var rpcIdentity = getCurrentRpcIdentity();
            var currentRecords = [];

            for (var i = 0; i < jobs.length; i++) {
                if (jobs[i].rpcIdentity === rpcIdentity) {
                    currentRecords.push(jobs[i]);
                }
            }

            return currentRecords;
        };

        var getCurrentJobs = function () {
            var currentRecords = getCurrentRecords();
            var currentJobs = [];

            for (var i = 0; i < currentRecords.length; i++) {
                if (!isTerminalJob(currentRecords[i])) {
                    currentJobs.push(currentRecords[i]);
                }
            }

            return currentJobs;
        };

        var updateStatusValues = function () {
            var currentJobs = getCurrentJobs();
            var waiting = 0;

            for (var i = 0; i < currentJobs.length; i++) {
                if (currentJobs[i].stage === 'waiting-metadata' || currentJobs[i].stage === 'waiting-files') {
                    waiting++;
                }
            }

            status.total = aggregate.total;
            status.processed = aggregate.processed;
            status.waiting = waiting;
            status.filtered = aggregate.filtered;
            status.full = aggregate.full;
            status.fallback = aggregate.fallback;
        };

        var setVisibleStatus = function (type, textKey, textParams) {
            statusVersion++;
            status.visible = true;
            status.type = type;
            status.textKey = textKey;
            status.textParams = textParams;
            updateStatusValues();
        };

        var setIdleStatus = function () {
            statusVersion++;
            status.visible = false;
            status.type = 'idle';
            status.textKey = '';
            status.textParams = {};
            updateStatusValues();
        };

        // 隐藏计时器只作用于创建时的状态版本，旧批次的计时器不能隐藏新批次提示。
        var autoHideStatus = function (delay) {
            var version = statusVersion;
            $timeout(function () {
                if (version === statusVersion) {
                    status.visible = false;
                }
            }, delay);
        };

        var updateActiveStatus = function () {
            var currentJobs = getCurrentJobs();
            if (currentJobs.length < 1) {
                return;
            }

            var waiting = 0;
            for (var i = 0; i < currentJobs.length; i++) {
                if (currentJobs[i].stage === 'waiting-metadata' || currentJobs[i].stage === 'waiting-files') {
                    waiting++;
                }
            }

            if (waiting === currentJobs.length) {
                setVisibleStatus('waiting', 'format.bt-file-filter.waiting', {count: waiting});
            } else {
                setVisibleStatus('processing', 'format.bt-file-filter.processing', {
                    processed: aggregate.processed,
                    total: aggregate.total
                });
            }
        };

        var resetAggregate = function () {
            var currentRecords = getCurrentRecords();
            pollCursor = 0;
            automaticJobTurn = true;
            aggregate.total = currentRecords.length;
            aggregate.processed = 0;
            aggregate.filtered = 0;
            aggregate.full = 0;
            aggregate.fallback = 0;

            for (var i = 0; i < currentRecords.length; i++) {
                if (isTerminalJob(currentRecords[i])) {
                    var outcome = currentRecords[i].stage.substring('completed-'.length);
                    aggregate.processed++;
                    aggregate[outcome]++;
                }
            }
        };

        var synchronizeRpcIdentity = function () {
            var rpcIdentity = getCurrentRpcIdentity();
            if (activeRpcIdentity === rpcIdentity) {
                return false;
            }

            lifecycleGeneration++;
            activeRpcIdentity = rpcIdentity;
            resetAggregate();
            var currentJobCount = getCurrentJobs().length;
            if (currentJobCount < 1) {
                if (aggregate.processed > 0) {
                    showOutcomeSummary();
                } else {
                    setIdleStatus();
                }
            }
            bulkStatusRpcIdentity = rpcIdentity;
            setBulkIdleStatus();
            updateBulkRunningStatus();
            return true;
        };

        var isJobOnCurrentRpc = function (job, operation) {
            return isOperationCurrent(operation) && job.rpcIdentity === operation.rpcIdentity &&
                jobs.indexOf(job) >= 0;
        };

        var getOptionValue = function (options, key, defaultValue) {
            return typeof options[key] === 'undefined' ? defaultValue : String(options[key]);
        };

        var touchAndSave = function (job) {
            job.updatedAt = Date.now();
            saveJobs();
        };

        var removeJob = function (job) {
            var index = jobs.indexOf(job);
            if (index >= 0) {
                jobs.splice(index, 1);
                saveJobs();
            }
        };

        var responseHasSuccess = function (response) {
            return !!(response && (response.success || response.hasSuccess));
        };

        // 只有明确的 GID 不存在才按删除处理；断网、超时等暂时失败不能清空恢复队列。
        var isNotFoundResponse = function (response) {
            if (responseHasSuccess(response)) {
                return false;
            }

            var message = response && response.data && response.data.message;
            if (/gid.*not found|no such download.*gid/i.test(String(message || ''))) {
                return true;
            }

            var results = response && response.results;
            if (!Array.isArray(results)) {
                return false;
            }
            for (var i = 0; i < results.length; i++) {
                if (!responseHasSuccess(results[i])) {
                    var resultMessage = results[i] && results[i].data && results[i].data.message;
                    if (/gid.*not found|no such download.*gid/i.test(String(resultMessage || ''))) {
                        return true;
                    }
                }
            }
            return false;
        };

        // 选择集合按值比较，不依赖 RPC 返回顺序；排序副本以免改写已保存的目标快照。
        var sameIndexes = function (files, indexes) {
            var selected = [];
            for (var i = 0; i < files.length; i++) {
                if (String(files[i].selected) === 'true') {
                    selected.push(parseInt(files[i].index));
                }
            }

            if (selected.length !== indexes.length) {
                return false;
            }

            selected.sort(function (a, b) { return a - b; });
            var expected = indexes.slice().sort(function (a, b) { return a - b; });
            for (var j = 0; j < expected.length; j++) {
                if (selected[j] !== expected[j]) {
                    return false;
                }
            }

            return true;
        };

        // 先验证锁的对象身份，防止停止后迟到的回调释放另一次操作的锁。
        var finishTick = function (operation) {
            if (activeOperation !== operation) {
                return;
            }
            activeOperation = null;
            synchronizeRpcIdentity();
            if (getCurrentJobs().length > 0) {
                updateActiveStatus();
            }
        };

        var removeDeletedJob = function (job, operation) {
            if (!isJobOnCurrentRpc(job, operation)) {
                finishTick(operation);
                return;
            }

            removeJob(job);
            if (aggregate.total > aggregate.processed) {
                aggregate.total--;
            }
            if (getCurrentJobs().length < 1) {
                if (aggregate.processed > 0) {
                    showOutcomeSummary();
                } else {
                    setIdleStatus();
                }
            }
            finishTick(operation);
        };

        var notifyFallback = function () {
            ariaNgNotificationService.notifyInPage('', 'format.bt-file-filter.fallback', {
                type: 'warning',
                contentParams: {count: aggregate.fallback}
            });
        };

        var clearCompletedOutcomes = function () {
            var rpcIdentity = getCurrentRpcIdentity();
            var changed = false;

            for (var i = jobs.length - 1; i >= 0; i--) {
                if (jobs[i].rpcIdentity === rpcIdentity && isTerminalJob(jobs[i])) {
                    jobs.splice(i, 1);
                    changed = true;
                }
            }
            if (changed) {
                saveJobs();
            }
        };

        var showOutcomeSummary = function () {
            if (aggregate.fallback > 0) {
                setVisibleStatus('warning', 'format.bt-file-filter.fallback', {count: aggregate.fallback});
                notifyFallback();
                autoHideStatus(10000);
            } else {
                setVisibleStatus('complete', 'format.bt-file-filter.complete', {
                    filtered: aggregate.filtered,
                    full: aggregate.full
                });
                autoHideStatus(5000);
            }
            clearCompletedOutcomes();
        };

        // 先记录终态，再汇总整批结果；未完成任务仍存在时保留终态记录，供刷新后恢复统计。
        var completeJob = function (job, outcome, operation) {
            if (!isJobOnCurrentRpc(job, operation)) {
                finishTick(operation);
                return;
            }

            job.stage = 'completed-' + outcome;
            touchAndSave(job);
            aggregate.processed++;
            aggregate[outcome]++;

            if (getCurrentJobs().length < 1) {
                showOutcomeSummary();
            } else {
                updateActiveStatus();
            }
            finishTick(operation);
        };

        // 仅在新任务要求过滤后启动且任务仍暂停时恢复下载；稍后下载和复用已有任务都不能被自动启动覆盖。
        var startOrComplete = function (job, task, outcome, operation) {
            if (!isJobOnCurrentRpc(job, operation)) {
                finishTick(operation);
                return;
            }

            if (!job.startAfterFilter || job.preserveExistingSelection || task.status !== 'paused') {
                completeJob(job, outcome, operation);
                return;
            }

            job.stage = 'starting-' + outcome;
            touchAndSave(job);
            aria2TaskService.startTasks([task.gid], function (response) {
                if (!isJobOnCurrentRpc(job, operation)) {
                    finishTick(operation);
                    return;
                }

                if (responseHasSuccess(response)) {
                    completeJob(job, outcome, operation);
                } else if (isNotFoundResponse(response)) {
                    removeDeletedJob(job, operation);
                } else {
                    finishTick(operation);
                }
            }, true);
        };

        var processStartingJob = function (job, task, operation) {
            if (!isJobOnCurrentRpc(job, operation)) {
                finishTick(operation);
                return;
            }

            var outcome = job.stage.substring('starting-'.length);
            if (task.status === 'removed') {
                removeDeletedJob(job, operation);
                return;
            }
            if (task.status !== 'paused') {
                completeJob(job, outcome, operation);
                return;
            }

            startOrComplete(job, task, outcome, operation);
        };

        // 文件选择与清理选项必须同时匹配并持续稳定；单次匹配不足以证明 aria2 已完成状态切换。
        var hasStableAutomaticSelection = function (job, task, indexes, cleanup, options) {
            if (!sameIndexes(task.files, indexes) ||
                getOptionValue(options, 'bt-remove-unselected-file', 'false') !== cleanup) {
                job.verifiedAt = 0;
                return false;
            }
            if (!job.verifiedAt || Date.now() < job.verifiedAt) {
                job.verifiedAt = Date.now();
                return false;
            }
            return Date.now() - job.verifiedAt >= bulkConvergenceDelay;
        };

        // aria2.changeOption 自行处理活动任务的重启；这里仅等待读回，不主动暂停任务。
        var waitForAutomaticMutation = function (job, operation) {
            if (job.mutationRequestedAt > Date.now()) {
                job.mutationRequestedAt = Date.now();
            }
            if (job.verifiedAt || (job.mutationRequestedAt &&
                Date.now() - job.mutationRequestedAt < bulkMutationRestartDelay)) {
                finishTick(operation);
                return true;
            }
            return false;
        };

        var processRestoration = function (job, task, plan, operation) {
            if (!isJobOnCurrentRpc(job, operation)) {
                finishTick(operation);
                return;
            }

            var allIndexes = job.allIndexes || plan.allIndexes;
            var outcome = job.restorationOutcome || 'fallback';
            var fullSelection = allIndexes.join(',');
            aria2TaskService.getTaskOptions(task.gid, function (optionsResponse) {
                if (!isJobOnCurrentRpc(job, operation)) {
                    finishTick(operation);
                    return;
                }

                if (!optionsResponse || !optionsResponse.success) {
                    if (isNotFoundResponse(optionsResponse)) {
                        removeDeletedJob(job, operation);
                    } else {
                        finishTick(operation);
                    }
                    return;
                }

                var currentOptions = optionsResponse.data || {};
                if (job.originalRemoveUnselectedFile === null || typeof job.originalRemoveUnselectedFile === 'undefined') {
                    job.originalRemoveUnselectedFile = getOptionValue(currentOptions, 'bt-remove-unselected-file', 'false');
                }
                if (job.restoreAttempted && hasStableAutomaticSelection(job, task, allIndexes,
                    job.originalRemoveUnselectedFile, currentOptions)) {
                    startOrComplete(job, task, outcome, operation);
                    return;
                }

                if (waitForAutomaticMutation(job, operation)) {
                    return;
                }
                job.restoreAttempted = true;
                job.mutationRequestedAt = Date.now();
                touchAndSave(job);
                aria2TaskService.changeTaskOptions(task.gid, {
                    'select-file': fullSelection,
                    'bt-remove-unselected-file': job.originalRemoveUnselectedFile
                }, function (response) {
                    if (!isJobOnCurrentRpc(job, operation)) {
                        finishTick(operation);
                        return;
                    }

                    if (isNotFoundResponse(response)) {
                        removeDeletedJob(job, operation);
                    } else {
                        finishTick(operation);
                    }
                }, true);
            }, true);
        };

        // 首次写入前保存原选项和目标选择，重试沿用快照，不能把中间状态重新当作原始状态。
        var processMixedTask = function (job, task, plan, operation) {
            if (!isJobOnCurrentRpc(job, operation)) {
                finishTick(operation);
                return;
            }

            aria2TaskService.getTaskOptions(task.gid, function (optionsResponse) {
                if (!isJobOnCurrentRpc(job, operation)) {
                    finishTick(operation);
                    return;
                }

                if (!optionsResponse || !optionsResponse.success) {
                    if (isNotFoundResponse(optionsResponse)) {
                        removeDeletedJob(job, operation);
                    } else {
                        finishTick(operation);
                    }
                    return;
                }

                var currentOptions = optionsResponse.data || {};
                if (job.originalRemoveUnselectedFile === null || typeof job.originalRemoveUnselectedFile === 'undefined') {
                    job.originalRemoveUnselectedFile = getOptionValue(currentOptions, 'bt-remove-unselected-file', 'false');
                }
                job.selectedIndexes = job.selectedIndexes || plan.selectedIndexes;
                job.allIndexes = job.allIndexes || plan.allIndexes;

                var targetRemoveUnselectedFile = job.preserveExistingSelection &&
                    plan.allIndexes.length < getRealFiles(task.files).length ?
                    job.originalRemoveUnselectedFile : 'true';
                if (job.stage === 'applying-filter' && hasStableAutomaticSelection(job, task,
                    job.selectedIndexes, targetRemoveUnselectedFile, currentOptions)) {
                    startOrComplete(job, task, 'filtered', operation);
                    return;
                }

                if (waitForAutomaticMutation(job, operation)) {
                    return;
                }

                if (job.stage === 'applying-filter' && job.retryCount >= 3) {
                    job.stage = 'restoring-full';
                    job.restoreAttempted = false;
                    job.restorationOutcome = 'fallback';
                    job.mutationRequestedAt = 0;
                    job.verifiedAt = 0;
                    touchAndSave(job);
                    processRestoration(job, task, plan, operation);
                    return;
                }

                job.stage = 'applying-filter';
                job.retryCount++;
                job.mutationRequestedAt = Date.now();
                touchAndSave(job);
                aria2TaskService.changeTaskOptions(task.gid, {
                    'select-file': plan.selectedIndexes.join(','),
                    'bt-remove-unselected-file': targetRemoveUnselectedFile
                }, function (response) {
                    if (!isJobOnCurrentRpc(job, operation)) {
                        finishTick(operation);
                        return;
                    }

                    if (isNotFoundResponse(response)) {
                        removeDeletedJob(job, operation);
                    } else {
                        if (!response || !response.success) {
                            job.mutationRequestedAt = 0;
                            touchAndSave(job);
                        }
                        finishTick(operation);
                    }
                }, true);
            }, true);
        };

        var processBtTask = function (job, task, operation) {
            if (!isJobOnCurrentRpc(job, operation)) {
                finishTick(operation);
                return;
            }

            if (job.pauseOwned && task.status === 'paused') {
                job.resumeRequested = true;
                job.verifiedAt = 0;
                touchAndSave(job);
                aria2TaskService.startTasks([task.gid], function () {
                    finishTick(operation);
                }, true);
                return;
            }
            if (job.pauseOwned && job.resumeRequested &&
                (task.status === 'active' || task.status === 'waiting')) {
                job.pauseOwned = false;
                job.resumeRequested = false;
                touchAndSave(job);
            }

            var plan;
            if (job.stage === 'applying-filter' && job.selectedIndexes && job.allIndexes) {
                plan = {mode: 'filter', selectedIndexes: job.selectedIndexes, allIndexes: job.allIndexes};
            } else if (job.preserveExistingSelection) {
                var existingPlan = planExistingTaskFiles(task.files, job.thresholdBytes);
                plan = {
                    mode: existingPlan.mode === 'filter' ? 'filter' : 'all-large',
                    selectedIndexes: existingPlan.targetSelectedIndexes,
                    allIndexes: existingPlan.originalSelectedIndexes
                };
            } else {
                plan = planFiles(task.files, job.thresholdBytes);
            }
            if (job.stage === 'restoring-full') {
                processRestoration(job, task, plan, operation);
            } else if (plan.mode === 'filter') {
                processMixedTask(job, task, plan, operation);
            } else if (plan.mode === 'all-small' && !sameIndexes(task.files, plan.allIndexes)) {
                job.stage = 'restoring-full';
                job.restoreAttempted = false;
                job.restorationOutcome = 'full';
                job.allIndexes = plan.allIndexes;
                touchAndSave(job);
                processRestoration(job, task, plan, operation);
            } else {
                startOrComplete(job, task, 'full', operation);
            }
        };

        // 这是新任务的明确“稍后下载”意图，不能套用于按 InfoHash 找回的已有任务。
        var pauseForDownloadLater = function (job, task, operation) {
            if (!isJobOnCurrentRpc(job, operation)) {
                finishTick(operation);
                return;
            }

            aria2TaskService.pauseTasks([task.gid], function (response) {
                if (!isJobOnCurrentRpc(job, operation)) {
                    finishTick(operation);
                    return;
                }

                if (isNotFoundResponse(response)) {
                    removeDeletedJob(job, operation);
                } else {
                    finishTick(operation);
                }
            }, true);
        };

        var addRecoveryCandidate = function (map, key, gid) {
            if (!key || !gid) {
                return;
            }
            if (!map[key]) {
                map[key] = [];
            }
            if (map[key].indexOf(gid) < 0) {
                map[key].push(gid);
            }
        };

        var buildRecoveryCandidates = function (tasks) {
            var candidates = {
                byRootGid: {},
                byInfoHash: {}
            };

            for (var i = 0; i < tasks.length; i++) {
                addRecoveryCandidate(candidates.byRootGid, tasks[i].following, tasks[i].gid);
                addRecoveryCandidate(candidates.byInfoHash, normalizeInfoHash(tasks[i].infoHash), tasks[i].gid);
            }

            return candidates;
        };

        var mergeRecoveryCandidates = function (first, second) {
            var merged = (first || []).slice();
            var additional = second || [];
            for (var i = 0; i < additional.length; i++) {
                if (merged.indexOf(additional[i]) < 0) {
                    merged.push(additional[i]);
                }
            }
            return merged;
        };

        var adoptRecoveredChild = function (job, childGid, preserveExistingSelection) {
            job.childGid = childGid;
            job.stage = 'waiting-files';
            if (preserveExistingSelection) {
                job.preserveExistingSelection = true;
            }
            job.missingRootScanCount = 0;
            job.terminalChildScanCount = 0;
            job.updatedAt = Date.now();
        };

        // 元数据根任务可能已消失；先从等待列表（含暂停任务）找子任务，再查活动列表。
        // 候选必须唯一，宁可继续等待也不能接管同 Hash 的另一任务。
        var recoverMetadataChild = function (job, operation, terminalStatus) {
            aria2TaskService.getTaskList('waiting', true, function (response) {
                if (!isJobOnCurrentRpc(job, operation)) {
                    finishTick(operation);
                    return;
                }

                if (!response || !response.success) {
                    finishTick(operation);
                    return;
                }

                var waitingCandidates = buildRecoveryCandidates(response.data || []);

                var currentJobs = getCurrentJobs();
                var recoveredCurrentJob = false;
                var recoveredAnyJob = false;
                for (var i = 0; i < currentJobs.length; i++) {
                    var currentJob = currentJobs[i];
                    var childGids = waitingCandidates.byRootGid[currentJob.rootGid] || [];
                    if (!currentJob.childGid && childGids.length === 1) {
                        adoptRecoveredChild(currentJob, childGids[0]);
                        recoveredAnyJob = true;
                        recoveredCurrentJob = recoveredCurrentJob || currentJob === job;
                    }
                }

                if (recoveredAnyJob) {
                    saveJobs();
                }

                if (recoveredCurrentJob) {
                    finishTick(operation);
                    return;
                }

                var currentChildGids = waitingCandidates.byRootGid[job.rootGid] || [];
                if (currentChildGids.length > 1) {
                    job.missingRootScanCount = 0;
                    job.terminalChildScanCount = 0;
                    touchAndSave(job);
                    finishTick(operation);
                    return;
                }

                recoverActiveChild(job, operation, terminalStatus,
                    waitingCandidates.byInfoHash);
            }, true, ['gid', 'following', 'infoHash']);
        };

        // 连接失败不计入“确实没找到”的扫描次数；按 Hash 复用的任务保留已有选择和启动意图。
        var recoverActiveChild = function (job, operation, terminalStatus, waitingGidsByInfoHash) {
            aria2TaskService.getTaskList('downloading', true, function (response) {
                if (!isJobOnCurrentRpc(job, operation)) {
                    finishTick(operation);
                    return;
                }

                if (!response || !response.success) {
                    finishTick(operation);
                    return;
                }

                var activeCandidates = buildRecoveryCandidates(response.data || []);

                var currentJobs = getCurrentJobs();
                var recoveredAnyJob = false;
                var recoveredCurrentJob = false;
                var ambiguousCurrentInfoHash = false;
                var duplicateCurrentJob = false;
                var infoHashJobCounts = {};
                var ownedChildGids = {};
                var currentRecords = getCurrentRecords();
                for (var i = 0; i < currentRecords.length; i++) {
                    if (currentRecords[i].childGid) {
                        ownedChildGids[currentRecords[i].childGid] = true;
                    }
                }
                for (i = 0; i < currentJobs.length; i++) {
                    if (currentJobs[i].infoHash) {
                        infoHashJobCounts[currentJobs[i].infoHash] =
                            (infoHashJobCounts[currentJobs[i].infoHash] || 0) + 1;
                    }
                }

                for (var j = 0; j < currentJobs.length; j++) {
                    var currentJob = currentJobs[j];
                    var childGids = activeCandidates.byRootGid[currentJob.rootGid] || [];
                    var recoveredByInfoHash = false;
                    if (!currentJob.childGid && childGids.length < 1 && currentJob.infoHash) {
                        childGids = mergeRecoveryCandidates(
                            waitingGidsByInfoHash[currentJob.infoHash],
                            activeCandidates.byInfoHash[currentJob.infoHash]
                        );
                        recoveredByInfoHash = childGids.length > 0;
                        if (childGids.length > 1 || infoHashJobCounts[currentJob.infoHash] > 1) {
                            ambiguousCurrentInfoHash = ambiguousCurrentInfoHash || currentJob === job;
                            childGids = [];
                        } else if (childGids.length === 1 && ownedChildGids[childGids[0]]) {
                            duplicateCurrentJob = duplicateCurrentJob || currentJob === job;
                            childGids = [];
                        }
                    }
                    if (!currentJob.childGid && childGids.length === 1) {
                        adoptRecoveredChild(currentJob, childGids[0], recoveredByInfoHash);
                        recoveredAnyJob = true;
                        recoveredCurrentJob = recoveredCurrentJob || currentJob === job;
                    }
                }

                if (recoveredAnyJob) {
                    saveJobs();
                }

                if (recoveredCurrentJob) {
                    finishTick(operation);
                    return;
                }

                if (duplicateCurrentJob) {
                    removeDeletedJob(job, operation);
                    return;
                }

                if (ambiguousCurrentInfoHash) {
                    job.missingRootScanCount = 0;
                    job.terminalChildScanCount = 0;
                    touchAndSave(job);
                    finishTick(operation);
                    return;
                }

                var counter = terminalStatus ? 'terminalChildScanCount' : 'missingRootScanCount';
                job[counter] = normalizeInteger(job[counter], 0) + 1;
                if (job[counter] >= missingRootScanLimit) {
                    removeDeletedJob(job, operation);
                    return;
                }
                touchAndSave(job);

                finishTick(operation);
            }, true, ['gid', 'following', 'infoHash']);
        };

        var processTaskResponse = function (job, response, operation) {
            if (!isJobOnCurrentRpc(job, operation)) {
                finishTick(operation);
                return;
            }

            if (!response || !response.success) {
                if (isNotFoundResponse(response)) {
                    if (!job.childGid && (job.sourceType === 'magnet' || job.sourceType === 'remote-torrent')) {
                        recoverMetadataChild(job, operation, null);
                    } else {
                        removeDeletedJob(job, operation);
                    }
                } else {
                    finishTick(operation);
                }
                return;
            }

            var task = response.data;
            if (task.status === 'removed') {
                removeDeletedJob(job, operation);
                return;
            }
            if (job.missingRootScanCount) {
                job.missingRootScanCount = 0;
                touchAndSave(job);
            }

            var isMetadataRoot = !job.childGid &&
                (job.sourceType === 'magnet' || job.sourceType === 'remote-torrent');
            var taskInfoHash = normalizeInfoHash(task.infoHash);
            var isDuplicateInfoHashRoot = isMetadataRoot && task.status === 'error' &&
                String(task.errorCode) === '12' && taskInfoHash;
            if (isDuplicateInfoHashRoot && job.infoHash !== taskInfoHash) {
                job.infoHash = taskInfoHash;
                touchAndSave(job);
            } else if (isMetadataRoot && job.infoHash && !isDuplicateInfoHashRoot) {
                delete job.infoHash;
                touchAndSave(job);
            }
            if (job.stage.indexOf('starting-') === 0) {
                processStartingJob(job, task, operation);
            } else if (isMetadataRoot && task.followedBy && task.followedBy.length === 1) {
                job.childGid = task.followedBy[0];
                job.stage = 'waiting-files';
                job.terminalChildScanCount = 0;
                touchAndSave(job);
                finishTick(operation);
            } else if (isMetadataRoot && task.followedBy && task.followedBy.length > 1) {
                job.stage = 'waiting-metadata';
                job.terminalChildScanCount = 0;
                touchAndSave(job);
                finishTick(operation);
            } else if (isMetadataRoot && (task.status === 'complete' || task.status === 'error')) {
                recoverMetadataChild(job, operation, task.status);
            } else if (isMetadataRoot) {
                job.stage = 'waiting-metadata';
                touchAndSave(job);
                finishTick(operation);
            } else if (task.bittorrent && task.files && task.files.length > 0) {
                if (!job.startAfterFilter && !job.preserveExistingSelection &&
                    (task.status === 'active' || task.status === 'waiting')) {
                    pauseForDownloadLater(job, task, operation);
                } else {
                    processBtTask(job, task, operation);
                }
            } else {
                job.stage = 'waiting-metadata';
                touchAndSave(job);
                finishTick(operation);
            }
        };

        var isBulkRunOnCurrentRpc = function (definition, progress, operation) {
            return isOperationCurrent(operation) &&
                bulkDefinitions.indexOf(definition) >= 0 && bulkProgresses.indexOf(progress) >= 0 &&
                definition.rpcIdentity === operation.rpcIdentity && progress.rpcIdentity === operation.rpcIdentity;
        };

        var finishBulkTick = function (operation) {
            if (activeOperation !== operation) {
                return;
            }
            activeOperation = null;
            synchronizeRpcIdentity();
            updateBulkRunningStatus();
        };

        // 先持久化移除进度再宣布完成；写失败时保留批次，避免界面已完成而刷新后再次执行。
        var completeBulkRun = function (definition, progress, operation) {
            if (!isBulkRunOnCurrentRpc(definition, progress, operation)) {
                finishBulkTick(operation);
                return;
            }

            var progressIndex = bulkProgresses.indexOf(progress);
            bulkProgresses.splice(progressIndex, 1);
            if (!saveBulkProgresses()) {
                bulkProgresses.splice(progressIndex, 0, progress);
                finishBulkTick(operation);
                return;
            }

            bulkDefinitions.splice(bulkDefinitions.indexOf(definition), 1);
            saveBulkDefinitions();

            bulkStatusRpcIdentity = operation.rpcIdentity;
            bulkStatusVersion++;
            bulkStatus.visible = true;
            bulkStatus.type = 'complete';
            bulkStatus.completionId++;
            bulkStatus.currentGid = '';
            bulkStatus.currentStage = '';
            bulkStatus.thresholdBytes = definition.thresholdBytes;
            bulkStatus.thresholdMb = definition.thresholdBytes / 1024 / 1024;
            bulkStatus.total = definition.gids.length;
            bulkStatus.processed = progress.processed;
            bulkStatus.filtered = progress.filtered;
            bulkStatus.skipped = progress.skipped;
            bulkStatus.failed = progress.failed;
            bulkStatus.filteredFiles = progress.filteredFiles;
            var completionStatusVersion = bulkStatusVersion;
            $timeout(function () {
                if (bulkStatusVersion === completionStatusVersion && bulkStatus.type === 'complete') {
                    setBulkIdleStatus();
                }
            }, 5000);
            if (activeOperation === operation) {
                activeOperation = null;
            }
        };

        // 游标、计数和 current 一起保存；写失败回滚内存，保证统计按任务结算一次而非按 RPC 次数累加。
        var settleBulkCurrent = function (definition, progress, outcome, operation) {
            if (!isBulkRunOnCurrentRpc(definition, progress, operation)) {
                finishBulkTick(operation);
                return;
            }

            var current = progress.current;
            var previous = {
                cursor: progress.cursor,
                processed: progress.processed,
                filtered: progress.filtered,
                skipped: progress.skipped,
                failed: progress.failed,
                filteredFiles: progress.filteredFiles,
                current: current
            };
            progress.processed++;
            progress.cursor++;
            progress[outcome]++;
            if (outcome === 'filtered') {
                progress.filteredFiles += current.filteredFileCount || 0;
            }
            progress.current = null;
            if (!saveBulkProgresses()) {
                progress.cursor = previous.cursor;
                progress.processed = previous.processed;
                progress.filtered = previous.filtered;
                progress.skipped = previous.skipped;
                progress.failed = previous.failed;
                progress.filteredFiles = previous.filteredFiles;
                progress.current = previous.current;
                finishBulkTick(operation);
                return;
            }

            if (progress.cursor >= definition.gids.length) {
                completeBulkRun(definition, progress, operation);
            } else {
                automaticJobTurn = true;
                updateBulkRunningStatus();
                finishBulkTick(operation);
            }
        };

        // 先保存阶段、重试次数和写入时间，再发变更；回调只结束本轮，下一轮回读确认实际结果。
        var applyBulkOptions = function (definition, progress, task, operation) {
            if (!isBulkRunOnCurrentRpc(definition, progress, operation)) {
                finishBulkTick(operation);
                return;
            }

            var current = progress.current;
            current.stage = 'applying';
            current.retryCount++;
            current.mutationRequestedAt = Date.now();
            current.verifiedAt = 0;
            if (!saveBulkProgresses()) {
                finishBulkTick(operation);
                return;
            }
            updateBulkRunningStatus();

            aria2TaskService.changeTaskOptions(task.gid, {
                'select-file': current.targetSelectedIndexes.join(','),
                'bt-remove-unselected-file': current.targetRemoveUnselectedFile
            }, function (response) {
                if (!isBulkRunOnCurrentRpc(definition, progress, operation)) {
                    finishBulkTick(operation);
                    return;
                }
                if (isNotFoundResponse(response)) {
                    settleBulkCurrent(definition, progress, 'skipped', operation);
                } else {
                    finishBulkTick(operation);
                }
            }, true);
        };

        // 仅兼容旧版本已落盘的暂停归属；新批量任务不会主动暂停。
        var requestBulkResume = function (definition, progress, operation) {
            if (!isBulkRunOnCurrentRpc(definition, progress, operation)) {
                finishBulkTick(operation);
                return;
            }
            var current = progress.current;
            if (current.resumeRetryCount >= bulkMutationRetryLimit) {
                settleBulkCurrent(definition, progress, 'failed', operation);
                return;
            }
            current.resumeRetryCount++;
            if (!saveBulkProgresses()) {
                finishBulkTick(operation);
                return;
            }
            updateBulkRunningStatus();
            aria2TaskService.startTasks([current.gid], function () {
                finishBulkTick(operation);
            }, true);
        };

        var beginBulkResume = function (definition, progress, outcome, operation) {
            var current = progress.current;
            var previousStage = current.stage;
            var previousResumeOutcome = current.resumeOutcome;
            var previousResumeRetryCount = current.resumeRetryCount;
            current.stage = 'resuming';
            current.resumeOutcome = outcome;
            current.resumeRetryCount = 0;
            current.verifiedAt = 0;
            if (!saveBulkProgresses()) {
                current.stage = previousStage;
                current.resumeOutcome = previousResumeOutcome;
                current.resumeRetryCount = previousResumeRetryCount;
                finishBulkTick(operation);
                return;
            }
            updateBulkRunningStatus();
            requestBulkResume(definition, progress, operation);
        };

        // 失败补偿恢复原来的已选子集和清理选项，不能扩大为全选；恢复成功仍算本次过滤失败。
        var restoreBulkOptions = function (definition, progress, task, options, operation) {
            if (!isBulkRunOnCurrentRpc(definition, progress, operation)) {
                finishBulkTick(operation);
                return;
            }
            var current = progress.current;
            if (sameIndexes(task.files, current.originalSelectedIndexes) &&
                getOptionValue(options, 'bt-remove-unselected-file', 'false') ===
                    current.originalRemoveUnselectedFile) {
                settleBulkCurrent(definition, progress, 'failed', operation);
                return;
            }

            if (current.restoreRetryCount >= bulkMutationRetryLimit) {
                settleBulkCurrent(definition, progress, 'failed', operation);
                return;
            }

            var previousRestoreRetryCount = current.restoreRetryCount;
            current.restoreRetryCount++;
            current.mutationRequestedAt = Date.now();
            current.verifiedAt = 0;
            if (!saveBulkProgresses()) {
                current.restoreRetryCount = previousRestoreRetryCount;
                finishBulkTick(operation);
                return;
            }

            aria2TaskService.changeTaskOptions(task.gid, {
                'select-file': current.originalSelectedIndexes.join(','),
                'bt-remove-unselected-file': current.originalRemoveUnselectedFile
            }, function (response) {
                if (!isBulkRunOnCurrentRpc(definition, progress, operation)) {
                    finishBulkTick(operation);
                    return;
                }
                if (isNotFoundResponse(response)) {
                    settleBulkCurrent(definition, progress, 'skipped', operation);
                } else {
                    finishBulkTick(operation);
                }
            }, true);
        };

        var beginBulkRestoration = function (definition, progress, task, options, operation) {
            var current = progress.current;
            var previousRestoreRetryCount = current.restoreRetryCount;
            current.stage = 'restoring';
            current.restoreRetryCount = 0;
            if (!saveBulkProgresses()) {
                current.stage = 'applying';
                current.restoreRetryCount = previousRestoreRetryCount;
                finishBulkTick(operation);
                return;
            }
            updateBulkRunningStatus();
            restoreBulkOptions(definition, progress, task, options, operation);
        };

        var applyBulkInspection = function (definition, progress, task, options, operation) {
            if (!isBulkRunOnCurrentRpc(definition, progress, operation)) {
                finishBulkTick(operation);
                return;
            }
            if (isTaskOwnedByAutomaticJob(task,
                getAutomaticOwnedGids(operation.rpcIdentity)) ||
                !isActiveBtPayloadTask(task)) {
                settleBulkCurrent(definition, progress, 'skipped', operation);
                return;
            }

            var current = progress.current;
            var plan = planExistingTaskFiles(task.files, definition.thresholdBytes);
            if (plan.mode !== 'filter') {
                settleBulkCurrent(definition, progress, 'skipped', operation);
                return;
            }
            var originalCleanup = getOptionValue(options, 'bt-remove-unselected-file', 'false');
            current.originalSelectedIndexes = plan.originalSelectedIndexes;
            current.targetSelectedIndexes = plan.targetSelectedIndexes;
            current.originalRemoveUnselectedFile = originalCleanup;
            current.targetRemoveUnselectedFile = plan.originalSelectedIndexes.length === plan.allIndexes.length ?
                'true' : originalCleanup;
            current.filteredFileCount = plan.filteredFileCount;
            current.pauseOwned = false;
            current.resumeRetryCount = 0;
            current.resumeOutcome = 'filtered';
            applyBulkOptions(definition, progress, task, operation);
        };

        // getOption 期间用户可能暂停或改选，因此拿到选项后再读取最新任务状态，随后才决定是否写入。
        var inspectBulkTaskAfterOptions = function (definition, progress, options, operation) {
            aria2TaskService.getTaskStatus(progress.current.gid, function (response) {
                if (!isBulkRunOnCurrentRpc(definition, progress, operation)) {
                    finishBulkTick(operation);
                    return;
                }
                if (!response || !response.success) {
                    if (isNotFoundResponse(response)) {
                        settleBulkCurrent(definition, progress, 'skipped', operation);
                    } else {
                        finishBulkTick(operation);
                    }
                    return;
                }
                applyBulkInspection(definition, progress, response.data, options, operation);
            }, true);
        };

        // 写入阶段按回读状态推进；旧检查点若拥有暂停归属，先恢复再结算。
        var inspectBulkOptions = function (definition, progress, task, operation) {
            aria2TaskService.getTaskOptions(task.gid, function (response) {
                if (!isBulkRunOnCurrentRpc(definition, progress, operation)) {
                    finishBulkTick(operation);
                    return;
                }
                if (!response || !response.success) {
                    if (isNotFoundResponse(response)) {
                        settleBulkCurrent(definition, progress, 'skipped', operation);
                    } else {
                        finishBulkTick(operation);
                    }
                    return;
                }

                var current = progress.current;
                var options = response.data || {};
                var outcome = current.stage === 'applying' ? 'filtered' :
                    current.stage === 'restoring' ? 'failed' : current.resumeOutcome;
                var expectedIndexes = outcome === 'filtered' ? current.targetSelectedIndexes :
                    current.originalSelectedIndexes;
                var expectedCleanup = outcome === 'filtered' ? current.targetRemoveUnselectedFile :
                    current.originalRemoveUnselectedFile;
                if (sameIndexes(task.files, expectedIndexes) &&
                    getOptionValue(options, 'bt-remove-unselected-file', 'false') === expectedCleanup) {
                    if (current.verifiedAt &&
                        Date.now() - current.verifiedAt >= bulkConvergenceDelay) {
                        if (task.status === 'paused' && current.pauseOwned) {
                            beginBulkResume(definition, progress, outcome, operation);
                        } else {
                            settleBulkCurrent(definition, progress, outcome, operation);
                        }
                    } else if (!current.verifiedAt || Date.now() < current.verifiedAt) {
                        // 时钟回拨后重新计时，避免等待旧的未来时间戳。
                        current.verifiedAt = Date.now();
                        if (!saveBulkProgresses()) {
                            current.verifiedAt = 0;
                        }
                        finishBulkTick(operation);
                    } else {
                        finishBulkTick(operation);
                    }
                } else if (current.stage === 'applying' || current.stage === 'restoring') {
                    current.verifiedAt = 0;
                    if (Date.now() - current.mutationRequestedAt < bulkMutationRestartDelay) {
                        finishBulkTick(operation);
                    } else if (task.status === 'paused' && current.pauseOwned) {
                        beginBulkResume(definition, progress, outcome, operation);
                    } else if (outcome === 'filtered' && current.retryCount >= bulkMutationRetryLimit) {
                        beginBulkRestoration(definition, progress, task, options, operation);
                    } else if (outcome === 'filtered') {
                        applyBulkOptions(definition, progress, task, operation);
                    } else if (current.restoreRetryCount >= bulkMutationRetryLimit) {
                        settleBulkCurrent(definition, progress, 'failed', operation);
                    } else {
                        restoreBulkOptions(definition, progress, task, options, operation);
                    }
                } else if (outcome === 'filtered') {
                    if (current.retryCount >= bulkMutationRetryLimit) {
                        beginBulkRestoration(definition, progress, task, options, operation);
                    } else {
                        applyBulkOptions(definition, progress, task, operation);
                    }
                } else if (current.restoreRetryCount >= bulkMutationRetryLimit) {
                    settleBulkCurrent(definition, progress, 'failed', operation);
                } else {
                    restoreBulkOptions(definition, progress, task, options, operation);
                }
            }, true);
        };

        var processBulkTaskResponse = function (definition, progress, response, operation) {
            if (!isBulkRunOnCurrentRpc(definition, progress, operation)) {
                finishBulkTick(operation);
                return;
            }
            if (!response || !response.success) {
                if (isNotFoundResponse(response)) {
                    settleBulkCurrent(definition, progress,
                        progress.current.stage === 'resuming' ? 'failed' : 'skipped', operation);
                } else {
                    finishBulkTick(operation);
                }
                return;
            }

            var task = response.data;
            var current = progress.current;
            if (current.stage === 'resuming') {
                if (task.status !== 'paused') {
                    inspectBulkOptions(definition, progress, task, operation);
                } else {
                    requestBulkResume(definition, progress, operation);
                }
                return;
            }
            if (!isBtPayloadTask(task)) {
                if (task.status === 'paused' && current.pauseOwned) {
                    beginBulkResume(definition, progress, 'failed', operation);
                } else if (task.status === 'paused') {
                    aria2TaskService.getTaskOptions(task.gid, function (optionsResponse) {
                        if (!isBulkRunOnCurrentRpc(definition, progress, operation)) {
                            finishBulkTick(operation);
                            return;
                        }
                        if (optionsResponse && optionsResponse.success) {
                            restoreBulkOptions(definition, progress, task, optionsResponse.data || {}, operation);
                        } else if (isNotFoundResponse(optionsResponse)) {
                            settleBulkCurrent(definition, progress, 'skipped', operation);
                        } else {
                            finishBulkTick(operation);
                        }
                    }, true);
                } else {
                    settleBulkCurrent(definition, progress, 'skipped', operation);
                }
                return;
            }
            if (current.stage === 'pausing') {
                if (task.status === 'paused' || task.status === 'active' || task.status === 'waiting') {
                    // 旧版暂停检查点改走普通回读；只保留已观察到的暂停归属。
                    var previousPauseOwned = current.pauseOwned;
                    if (task.status !== 'paused') {
                        // 刷新后旧暂停 RPC 不会再到达；活动任务不能占用未来的用户暂停。
                        current.pauseOwned = false;
                    }
                    current.stage = current.resumeOutcome === 'filtered' ? 'applying' : 'restoring';
                    current.verifiedAt = 0;
                    if (!saveBulkProgresses()) {
                        current.stage = 'pausing';
                        current.pauseOwned = previousPauseOwned;
                        finishBulkTick(operation);
                        return;
                    }
                    inspectBulkOptions(definition, progress, task, operation);
                } else {
                    settleBulkCurrent(definition, progress, 'skipped', operation);
                }
                return;
            }
            if (current.stage === 'applying' || current.stage === 'restoring') {
                if (task.status === 'paused' || task.status === 'active' || task.status === 'waiting') {
                    inspectBulkOptions(definition, progress, task, operation);
                } else {
                    settleBulkCurrent(definition, progress, 'failed', operation);
                }
                return;
            }
        };

        var processBulkTick = function (definition, progress, operation) {
            if (!progress.current) {
                if (progress.cursor >= definition.gids.length) {
                    completeBulkRun(definition, progress, operation);
                    return;
                }
                progress.current = {
                    gid: definition.gids[progress.cursor],
                    stage: 'inspecting',
                    retryCount: 0,
                    restoreRetryCount: 0,
                    pauseOwned: false,
                    mutationRequestedAt: 0,
                    verifiedAt: 0,
                    resumeRetryCount: 0,
                    resumeOutcome: 'failed',
                    filteredFileCount: 0
                };
                if (!saveBulkProgresses()) {
                    progress.current = null;
                    finishBulkTick(operation);
                    return;
                }
                updateBulkRunningStatus();
            }

            if (progress.current.stage === 'inspecting') {
                aria2TaskService.getTaskOptions(progress.current.gid, function (response) {
                    if (!isBulkRunOnCurrentRpc(definition, progress, operation)) {
                        finishBulkTick(operation);
                        return;
                    }
                    if (!response || !response.success) {
                        if (isNotFoundResponse(response)) {
                            settleBulkCurrent(definition, progress, 'skipped', operation);
                        } else {
                            finishBulkTick(operation);
                        }
                        return;
                    }
                    inspectBulkTaskAfterOptions(definition, progress, response.data || {}, operation);
                }, true);
                return;
            }

            aria2TaskService.getTaskStatus(progress.current.gid, function (response) {
                processBulkTaskResponse(definition, progress, response, operation);
            }, true);
        };

        // 自动和批量流程共用一把锁并轮流获得执行机会；同一时刻只推进一条 RPC 链。
        var tick = function () {
            if (activeOperation !== null) {
                return;
            }

            synchronizeRpcIdentity();
            var rpcIdentity = getCurrentRpcIdentity();
            var operation = createOperationContext(rpcIdentity);
            var bulkDefinition = findBulkDefinition(rpcIdentity);
            var bulkProgress = findBulkProgress(rpcIdentity);
            var currentJobs = getCurrentJobs();
            if (currentJobs.length > 0 && (!bulkDefinition || !bulkProgress || automaticJobTurn)) {
                activeOperation = operation;
                if (bulkDefinition && bulkProgress) {
                    automaticJobTurn = false;
                }
                var job = currentJobs[pollCursor % currentJobs.length];
                pollCursor++;
                aria2TaskService.getTaskStatus(job.childGid || job.rootGid, function (response) {
                    processTaskResponse(job, response, operation);
                }, true);
                return;
            }
            if (bulkDefinition && bulkProgress) {
                automaticJobTurn = currentJobs.length > 0;
                activeOperation = operation;
                processBulkTick(bulkDefinition, bulkProgress, operation);
            }
        };

        // 提交时冻结 GID 列表和阈值，同一 RPC 只允许一个批次；两份存储任一失败都不能当作提交成功。
        var enqueueBulk = function (gids, thresholdBytes) {
            var rpcIdentity = getCurrentRpcIdentity();
            if (findBulkDefinition(rpcIdentity) || !Array.isArray(gids) ||
                !isFinite(thresholdBytes) || thresholdBytes <= 0) {
                return false;
            }

            var definition = sanitizeBulkDefinition({
                rpcIdentity: rpcIdentity,
                thresholdBytes: thresholdBytes,
                gids: gids,
                createdAt: Date.now()
            });
            if (!definition) {
                return false;
            }
            var progress = {
                rpcIdentity: rpcIdentity,
                cursor: 0,
                processed: 0,
                filtered: 0,
                skipped: 0,
                failed: 0,
                filteredFiles: 0,
                current: null
            };
            bulkDefinitions.push(definition);
            if (!saveBulkDefinitions()) {
                bulkDefinitions.pop();
                return false;
            }
            bulkProgresses.push(progress);
            if (!saveBulkProgresses()) {
                bulkProgresses.pop();
                bulkDefinitions.pop();
                saveBulkDefinitions();
                return false;
            }

            automaticJobTurn = true;
            bulkStatusRpcIdentity = rpcIdentity;
            updateBulkRunningStatus();
            return true;
        };

        var enqueue = function (rootGid, intent) {
            var rpcIdentity = getCurrentRpcIdentity();

            if (pollingPromise) {
                synchronizeRpcIdentity();
            }

            for (var i = 0; i < jobs.length; i++) {
                if (jobs[i].rpcIdentity === rpcIdentity && jobs[i].rootGid === rootGid) {
                    return;
                }
            }

            var timestamp = Date.now();
            var currentCount = getCurrentJobs().length;
            var job = sanitizeJob({
                rpcIdentity: rpcIdentity,
                rootGid: rootGid,
                childGid: '',
                thresholdBytes: intent && intent.thresholdBytes,
                startAfterFilter: intent && intent.startAfterFilter,
                sourceType: intent && intent.sourceType,
                stage: 'waiting-metadata',
                retryCount: 0,
                originalRemoveUnselectedFile: null,
                missingRootScanCount: 0,
                terminalChildScanCount: 0,
                createdAt: timestamp,
                updatedAt: timestamp
            });
            if (!job) {
                return;
            }
            jobs.push(job);
            saveJobs();

            if (pollingPromise) {
                if (currentCount < 1) {
                    resetAggregate();
                } else {
                    aggregate.total++;
                }
                updateActiveStatus();
            }
        };

        var start = function () {
            if (pollingPromise) {
                return pollingPromise;
            }

            var currentJobs = getCurrentJobs();
            lifecycleGeneration++;
            activeRpcIdentity = getCurrentRpcIdentity();
            resetAggregate();
            if (currentJobs.length > 0) {
                if (restoredQueue) {
                    setVisibleStatus('resuming', 'format.bt-file-filter.resuming', {count: currentJobs.length});
                } else {
                    updateActiveStatus();
                }
            } else if (aggregate.processed > 0) {
                showOutcomeSummary();
            }
            restoredQueue = false;
            bulkStatusRpcIdentity = activeRpcIdentity;
            updateBulkRunningStatus();
            pollingPromise = $interval(tick, pollingInterval, 0, false);
            return pollingPromise;
        };

        // 停止轮询并使旧回调失效，但保留持久化队列，重连或重新启动后仍可恢复。
        var stop = function () {
            lifecycleGeneration++;
            if (pollingPromise) {
                $interval.cancel(pollingPromise);
                pollingPromise = null;
            }

            activeOperation = null;
            pollCursor = 0;
            setIdleStatus();
            setBulkIdleStatus();
        };

        // 徽标来自协调器当前操作而非 aria2 下载状态；停止后返回空表，由界面清除旧徽标。
        var buildPendingGidStageMap = function () {
            var map = {};
            if (!pollingPromise) {
                return map;
            }
            var currentJobs = getCurrentJobs();

            for (var i = 0; i < currentJobs.length; i++) {
                var job = currentJobs[i];
                if (job.rootGid) {
                    map[job.rootGid] = job.stage;
                }
                if (job.childGid) {
                    map[job.childGid] = job.stage;
                }
            }

            var bulkProgress = findBulkProgress(getCurrentRpcIdentity());
            if (bulkProgress && bulkProgress.current) {
                var bulkStageMap = {
                    inspecting: 'bulk-inspecting',
                    pausing: 'applying-filter',
                    applying: 'applying-filter',
                    restoring: 'restoring-full'
                };
                var stage = bulkProgress.current.stage === 'resuming' ?
                    (bulkProgress.current.resumeOutcome === 'filtered' ?
                        'starting-filtered' : 'starting-full') :
                    bulkStageMap[bulkProgress.current.stage];
                if (stage) {
                    map[bulkProgress.current.gid] = stage;
                }
            }

            return map;
        };

        return {
            isBtMetadataUrl: isBtMetadataUrl,
            planFiles: planFiles,
            isActiveBtPayloadTask: isActiveBtPayloadTask,
            planExistingTaskFiles: planExistingTaskFiles,
            getBulkPreview: getBulkPreview,
            enqueueBulk: enqueueBulk,
            enqueue: enqueue,
            getJobs: function () {
                return sanitizeQueue(jobs);
            },
            getPendingGidStageMap: function () {
                return buildPendingGidStageMap();
            },
            getStatus: function () {
                return status;
            },
            getBulkStatus: function () {
                if (bulkStatusRpcIdentity !== getCurrentRpcIdentity()) {
                    bulkStatusRpcIdentity = getCurrentRpcIdentity();
                    setBulkIdleStatus();
                    updateBulkRunningStatus();
                }
                return bulkStatus;
            },
            start: start,
            stop: stop
        };
    }]);
}());
