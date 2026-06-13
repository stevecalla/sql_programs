/**
 * excel_output.test.js — Excel workbook writer (writes a real .xlsx to a temp dir and
 * reads it back with exceljs).
 *   node --test tests/excel_output.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const ExcelJS = require('exceljs');

const { write_workbook, sheet_name } = require('../src/excel_output');

describe('sheet_name', () => {
    test('strips Excel-illegal characters and caps at 31 chars', () => {
        assert.equal(sheet_name('exact'), 'exact');
        assert.equal(sheet_name('a/b:c*d?e[f]g\\h'), 'a_b_c_d_e_f_g_h');
        assert.equal(sheet_name('x'.repeat(40)).length, 31);
        assert.equal(sheet_name(''), 'Sheet');
        assert.equal(sheet_name(null), 'Sheet');
    });
});

describe('write_workbook', () => {
    test('writes one tab per view with headers + rows, read back correctly', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-'));
        const file = path.join(dir, 'out.xlsx');

        await write_workbook(file, [
            { name: 'exact', rows: [
                { Run_Id__c: 'r1', Match_Type__c: 'exact_group', Duplicate_Count__c: 2 },
                { Run_Id__c: 'r1', Match_Type__c: 'exact_group', Duplicate_Count__c: 3 },
            ] },
            { name: 'fuzzy_pair', rows: [{ Run_Id__c: 'r1', Match_Type__c: 'fuzzy_pair' }] },
            { name: 'nickname_pair', rows: [] }, // empty view -> empty tab
        ]);

        assert.ok(fs.existsSync(file));

        const wb = new ExcelJS.Workbook();
        await wb.xlsx.readFile(file);
        const names = wb.worksheets.map((w) => w.name);
        assert.deepEqual(names, ['exact', 'fuzzy_pair', 'nickname_pair']);

        const exact = wb.getWorksheet('exact');
        // row 1 = header, then 2 data rows
        assert.equal(exact.getRow(1).getCell(1).value, 'Run_Id__c');
        assert.equal(exact.getRow(2).getCell(1).value, 'r1');
        assert.equal(String(exact.getRow(2).getCell(3).value), '2');
        assert.equal(exact.actualRowCount, 3);

        const empty = wb.getWorksheet('nickname_pair');
        assert.equal(empty.actualRowCount, 0);

        fs.rmSync(dir, { recursive: true, force: true });
    });
});
