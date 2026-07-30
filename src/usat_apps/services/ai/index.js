'use strict';
// One import surface for the shared AI layer (data-in; no Salesforce dependency — the module fetches
// case data via services/salesforce and passes it here). Consumed by the email-queue module and, later,
// the chatbot.
const providers = require('./providers');
const models = require('./models');
const respond = require('./respond');
const triage = require('./triage');
const ask = require('./ask');
const extract = require('./extract');
const context = require('./context');
const prompt = require('./prompt');

module.exports = {
  list_providers: providers.list_providers, complete: providers.complete,
  resolve_model: providers.resolve_model, norm_completion: providers.norm_completion,
  DEFAULT_PROVIDER: providers.DEFAULT_PROVIDER,
  list_models: models.list, default_model: models.default_model,
  price_for: models.price_for, cost_for: models.cost_for, set_config_reader: models.set_config_reader,
  respond_to_case: respond.respond_to_case, parse_verdict: respond.parse_verdict, find_sender_email: respond.find_sender_email,
  triage_case: triage.triage_case, parse_triage: triage.parse_triage,
  ask_about_case: ask.ask_about_case,
  extract_text: extract.extract_text, build_context: context.build_context, SYSTEM: prompt.SYSTEM
};
