'use strict';
// snake_case file-naming for Salesforce downloads (single underscores, lowercase, stable layout).
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { snake_case, safe_file_name, build_download_file_name } = require('../sf/sf_naming');

describe('sf_naming', () => {
  test('snake_case lowercases, single-underscores, trims, drops extension', () => {
    assert.equal(snake_case('Spring Tri Results.xlsx'), 'spring_tri_results');
    assert.equal(snake_case('  Summer / Sprint  '), 'summer_sprint');
    assert.equal(snake_case('Already_snake'), 'already_snake');
    assert.equal(snake_case('a--b__c!!d'), 'a_b_c_d');
    assert.equal(snake_case(null), '');
    assert.equal(snake_case(12345), '12345');
  });

  test('safe_file_name keeps a single lowercased extension', () => {
    assert.equal(safe_file_name('My File.CSV'), 'my_file.csv');
    assert.equal(safe_file_name('no ext here'), 'no_ext_here');
  });

  test('build_download_file_name = program_owner_title_versionid.ext (event leads)', () => {
    const file = { Title: 'Spring Tri Results.xlsx', FileExtension: 'xlsx', Id: 'cv1' };
    assert.equal(
      build_download_file_name(file, 'Spring Triathlon', 'Jane Coordinator'),
      'spring_triathlon_jane_coordinator_spring_tri_results_cv1.xlsx'
    );
  });

  test('build_download_file_name falls back when program/owner missing', () => {
    const file = { Title: 'race.csv', FileExtension: 'csv', Id: 'cv9' };
    assert.equal(
      build_download_file_name(file, '', ''),
      'no_program_name_no_owner_name_race_cv9.csv'
    );
  });

  test('sanction id leads the name when present, and is omitted when blank (4th arg optional)', () => {
    const file = { Title: 'Spring Tri Results.xlsx', FileExtension: 'xlsx', Id: 'cv1' };
    assert.equal(
      build_download_file_name(file, 'Spring Triathlon', 'Jane Coordinator', '351003'),
      '351003_spring_triathlon_jane_coordinator_spring_tri_results_cv1.xlsx'
    );
    // blank/absent sanction -> identical to the legacy 3-arg name
    assert.equal(
      build_download_file_name(file, 'Spring Triathlon', 'Jane Coordinator', ''),
      build_download_file_name(file, 'Spring Triathlon', 'Jane Coordinator')
    );
  });
});
