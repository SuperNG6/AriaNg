(function () {
    'use strict';

    angular.module('ariaNg').provider('ariaNgAssetsCacheService', [function () {
        // All-In-One 在配置阶段注入语言文本，运行阶段通过同一字典读取；无原型对象避免语言名与继承键冲突。
        var languageAssets = Object.create(null);

        this.getLanguageAsset = function (languageName) {
            var content = languageAssets[languageName];
            return angular.isUndefined(content) ? null : content;
        };

        this.setLanguageAsset = function (languageName, languageContent) {
            languageAssets[languageName] = languageContent;
        };

        this.$get = function () {
            var that = this;

            return {
                getLanguageAsset: function (languageName) {
                    return that.getLanguageAsset(languageName);
                }
            };
        };
    }]);
}());
