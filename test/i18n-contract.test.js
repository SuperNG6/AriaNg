'use strict';

const assert = require('assert');
const fs = require('fs');

const releaseMode = process.argv.includes('--release');

const isBtFilterKey = function (key) {
    return key.indexOf('format.bt-file-filter') === 0 || key.indexOf('BT file filter') === 0 ||
        key.indexOf('Exclude BT task') === 0 || key.indexOf('BT task pending file filter') === 0;
};

const getPlaceholders = function (value) {
    return Array.from(value.matchAll(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g))
        .map(function (match) { return match[1]; })
        .sort();
};

const parseDefaultLanguage = function () {
    const source = fs.readFileSync('src/scripts/config/defaultLanguage.js', 'utf8');
    const values = {};
    Array.from(source.matchAll(/^\s*'([^']+)':\s*'((?:\\.|[^'])*)'/gm)).forEach(function (match) {
        if (isBtFilterKey(match[1])) {
            values[match[1]] = match[2];
        }
    });
    return values;
};

const parseLanguage = function (name) {
    const values = {};
    fs.readFileSync('src/langs/' + name, 'utf8').split(/\r?\n/).forEach(function (line) {
        const separator = line.indexOf('=');
        if (separator > 0) {
            const key = line.substring(0, separator);
            if (isBtFilterKey(key)) {
                values[key] = line.substring(separator + 1);
            }
        }
    });
    return values;
};

const expected = parseDefaultLanguage();
const expectedKeys = Object.keys(expected).sort();
const languageFiles = releaseMode ? fs.readdirSync('src/langs').filter(function (name) {
    return /\.txt$/.test(name);
}).sort() : ['zh_Hans.txt'];

languageFiles.forEach(function (name) {
    const actual = parseLanguage(name);
    assert.deepStrictEqual(Object.keys(actual).sort(), expectedKeys, name + ' BT filter keys differ');
    expectedKeys.forEach(function (key) {
        assert.deepStrictEqual(getPlaceholders(actual[key]), getPlaceholders(expected[key]),
            name + ' ' + key + ' placeholders differ');
    });
});

console.log('PASS ' + (releaseMode ? 'release' : 'development') +
    ' BT filter translation contract (' + languageFiles.length + ' language file(s))');
