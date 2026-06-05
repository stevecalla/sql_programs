/**
 * schema.js — the ONE place domain knowledge lives.
 *
 * TEMPLATE_SCHEMA is the ordered list of target columns (matching
 * "Steve Correct Format Rankings.xlsx"). Each entry declares:
 *   key        machine id
 *   target     exact header text in the output
 *   aliases    source-header synonyms used by the auto-matcher (normalized)
 *   required   whether a value is expected for every athlete
 *   normalizer name of the value normalizer in normalize.js
 *   is_time_total true only for the finish-time column (so splits are excluded)
 *   note       the template's own formatting instruction (for docs/UI tooltip)
 *
 * To teach the tool a new quirky file: add an alias or tweak a normalizer.
 * No other file should need editing.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RRT = root.RRT || {};
    root.RRT.schema = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TEMPLATE_SCHEMA = [
    { key: 'member_number', target: 'Member Number', normalizer: 'member', required: true,
      aliases: ['member number','member #','member no','usat member','usat member #','usat #','usat number','usat id','membership','usat membership','member id','membership id','membership number','license','license #'],
      note: 'Numeric USAT id; if not an active member, "1-day" is placed here.' },
    { key: 'last_name', target: 'Last Name', normalizer: 'text', required: true,
      aliases: ['last name','last','surname','family name','lastname'],
      note: 'Athlete family/last name.' },
    { key: 'first_name', target: 'First Name', normalizer: 'text', required: true,
      aliases: ['first name','first','given name','firstname','forename'],
      note: 'Athlete given/first name.' },
    { key: 'gender', target: 'Gender', normalizer: 'gender', required: true,
      aliases: ['gender','sex','m f','gender identity'],
      note: 'M, F, NB, or Open.' },
    { key: 'dob', target: 'DOB', normalizer: 'dob', required: true,
      aliases: ['dob','date of birth','birth date','birthdate','born','d.o.b'],
      note: 'mm/dd/yyyy.' },
    { key: 'email', target: 'Email', normalizer: 'text', required: true,
      aliases: ['email','e-mail','email address','e mail','mail'],
      note: 'Athlete email address.' },
    { key: 'address', target: 'Address', normalizer: 'text', required: false,
      aliases: ['address','street','street address','address 1','address line 1','addr','mailing address'],
      note: 'Not required.' },
    { key: 'city', target: 'City', normalizer: 'text', required: true,
      aliases: ['city','town','municipality'],
      note: 'City name.' },
    { key: 'state', target: 'State', normalizer: 'state', required: true,
      aliases: ['state','st','province','region','state province'],
      note: '2-letter abbreviation.' },
    { key: 'zip', target: 'Zip', normalizer: 'text', required: true,
      aliases: ['zip','zip code','zipcode','postal code','postal','post code','postcode'],
      note: 'Postal / ZIP code.' },
    { key: 'category', target: 'Category', normalizer: 'category', required: true,
      aliases: ['category','division','age group','race category','class','wave','race division','division category','reg category'],
      note: 'One of: Age Group, Elite, Para, Relay, Open.' },
    { key: 'recorded_time', target: 'Recorded Time', normalizer: 'time', required: true, is_time_total: true,
      aliases: ['recorded time','final time','gun time','chip time','net time','finish time','total time','finish','overall time','elapsed time'],
      note: 'Total finish time as hh:mm:ss.000.' }
  ];

  // Header keywords that mark a column as a split/segment time -> never the
  // finish time, and dropped from the output.
  var SPLIT_KEYWORDS = ['leg','transition','t1','t2','t3','bike','swim','split','lap','pace','interval','run 1','run 2','run1','run2','segment','course'];

  // High-priority tokens that positively identify the finish/total time column.
  var TOTAL_TIME_TOKENS = ['gun','final','chip','net','finish','overall','total','recorded','elapsed'];

  // Single full-name columns to split into First/Last when neither is present.
  var NAME_ALIASES = ['name','full name','fullname','athlete','athlete name','participant',
    'participant name','racer','racer name','competitor','competitor name','runner','runner name'];

  var TARGET_HEADERS = TEMPLATE_SCHEMA.map(function (c) { return c.target; });

  function by_key(key) {
    for (var i = 0; i < TEMPLATE_SCHEMA.length; i++) if (TEMPLATE_SCHEMA[i].key === key) return TEMPLATE_SCHEMA[i];
    return null;
  }

  return {
    TEMPLATE_SCHEMA: TEMPLATE_SCHEMA,
    TARGET_HEADERS: TARGET_HEADERS,
    SPLIT_KEYWORDS: SPLIT_KEYWORDS,
    NAME_ALIASES: NAME_ALIASES,
    TOTAL_TIME_TOKENS: TOTAL_TIME_TOKENS,
    by_key: by_key
  };
}));
