(function () {
    'use strict';

    angular.module('ariaNg').factory('ariaNgBtFileFilterService', ['$interval', '$timeout', 'ariaNgConstants', 'ariaNgStorageService', 'ariaNgSettingService', 'ariaNgNotificationService', 'ariaNgLogService', 'aria2TaskService', function ($interval, $timeout, ariaNgConstants, ariaNgStorageService, ariaNgSettingService, ariaNgNotificationService, ariaNgLogService, aria2TaskService) {
        var storageKey = ariaNgConstants.btFileFilterQueueStorageKey;
        var jobs = ariaNgStorageService.get(storageKey) || [];
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

        var isBtMetadataUrl = function (url) {
            var normalized = String(url || '').trim();
            if (/^magnet:\?/i.test(normalized)) {
                return true;
            }

            var urlWithoutQueryOrFragment = normalized.split(/[?#]/)[0];
            return /^https?:\/\/[^/?#]+\/.*\.torrent$/i.test(urlWithoutQueryOrFragment);
        };

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

            return {
                mode: selectedIndexes.length > 0 && selectedIndexes.length < allIndexes.length ? 'filter' : 'full',
                selectedIndexes: selectedIndexes,
                allIndexes: allIndexes
            };
        };

        var enqueue = function (rootGid, intent) {
            var rpcIdentity = ariaNgSettingService.getCurrentRpcIdentity();

            for (var i = 0; i < jobs.length; i++) {
                if (jobs[i].rpcIdentity === rpcIdentity && jobs[i].rootGid === rootGid) {
                    return;
                }
            }

            var timestamp = Date.now();
            jobs.push({
                rpcIdentity: rpcIdentity,
                rootGid: rootGid,
                childGid: '',
                thresholdBytes: intent.thresholdBytes,
                startAfterFilter: intent.startAfterFilter,
                sourceType: intent.sourceType,
                stage: 'waiting-metadata',
                retryCount: 0,
                originalRemoveUnselectedFile: null,
                createdAt: timestamp,
                updatedAt: timestamp
            });
            ariaNgStorageService.set(storageKey, jobs);
        };

        return {
            isBtMetadataUrl: isBtMetadataUrl,
            planFiles: planFiles,
            enqueue: enqueue,
            getJobs: function () {
                return jobs;
            },
            getStatus: function () {
                return status;
            },
            start: function () {}
        };
    }]);
}());
