const { exec } = require('child_process');
const util = require('util');
const exec_async = util.promisify(exec);
const path = require('path');
const { runTimer: run_timer, stopTimer: stop_timer } = require('../../utilities/timer');

/**
 * Runs a Python script and logs timing.
 * @param {string} [script_path=default_script_path] - Absolute path to the Python script.
 * @returns {Promise<string>} Resolves with stdout.
*/
const default_script_path = path.join(__dirname, 'src/main.py');

async function execute_run_python_event_reports(script_path = default_script_path) {
  const start = Date.now();
  run_timer('get_data');

  try {
    const { stdout, stderr } = await exec_async(`python3 "${script_path}"`);

    const duration = ((Date.now() - start) / 1000).toFixed(2);
    console.log(`⏳ ${path.basename(script_path)} took ${duration} seconds`);

    if (stderr) {
      console.warn('⚠️ Python stderr:', stderr);
    }
    console.log('📄 Output from script:\n', stdout.trim());

    return stdout.trim();

  } catch (error) {
    console.error('❌ Failed to run process:', error.message);
    throw error;

  } finally {
    stop_timer('get_data');

  }
}

// execute_run_python_event_reports();

module.exports = { 
  execute_run_python_event_reports 
};
