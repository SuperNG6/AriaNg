// 同时验证配置阶段写入与运行阶段读取，保证离线包注入的语言资源可被同一缓存取回。
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let definition;
vm.runInNewContext(fs.readFileSync(path.join(__dirname,
    '../src/scripts/services/ariaNgAssetsCacheService.js'), 'utf8'), {
    angular: {
        isUndefined: (value) => value === undefined,
        module: () => ({provider: (name, value) => { definition = value; }})
    }
});
const provider = new definition[definition.length - 1]();
const service = provider.$get();
assert.strictEqual(service.getLanguageAsset('zh_Hans'), null);
const content = 'key=中文\nplaceholder={{count}}\nvalue=a=b';
provider.setLanguageAsset('zh_Hans', content);
assert.strictEqual(provider.getLanguageAsset('zh_Hans'), content);
assert.strictEqual(service.getLanguageAsset('zh_Hans'), content);
provider.setLanguageAsset('zh_Hans', 'updated');
assert.strictEqual(service.getLanguageAsset('zh_Hans'), 'updated');
provider.setLanguageAsset('fr', 'bonjour');
assert.strictEqual(service.getLanguageAsset('fr'), 'bonjour');
assert.strictEqual(service.getLanguageAsset('zh_Hans'), 'updated');
provider.setLanguageAsset('zh_Hans', '');
assert.strictEqual(service.getLanguageAsset('zh_Hans'), '');
provider.setLanguageAsset('zh_Hans', undefined);
assert.strictEqual(service.getLanguageAsset('zh_Hans'), null);
console.log('PASS provider and runtime language cache preserve content, isolation, overwrite and missing values');
