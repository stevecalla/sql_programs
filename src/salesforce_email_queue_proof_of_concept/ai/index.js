'use strict';
// One import surface for the AI layer.
const providers = require('./providers');
const models = require('./models');
const respond = require('./respond');
const triage = require('./triage');
const ask = require('./ask');
const extract = require('./extract');
const context = require('./context');
const prompt = require('./prompt');

module.exports = {
  list_providers: providers.list_providers,
  complete: providers.complete,
  resolve_model: providers.resolve_model,
  list_models: models.list, default_model: models.default_model,
  DEFAULT_PROVIDER: providers.DEFAULT_PROVIDER,
  respond_to_case: respond.respond_to_case,
  triage_case: triage.triage_case, parse_triage: triage.parse_triage,
  parse_verdict: respond.parse_verdict,
  ask_about_case: ask.ask_about_case,
  extract_text: extract.extract_text,
  build_context: context.build_context,
  SYSTEM: prompt.SYSTEM
};
