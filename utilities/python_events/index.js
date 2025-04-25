// index.js
// Ensures we pick up the project's venv Python, add timing, and run the analysis script

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { exec } = require('child_process');
const util = require('util');
const exec_async = util.promisify(exec);
const { runTimer: run_timer, stopTimer: stop_timer } = require('../../utilities/timer');

// Determine project root and venv paths
const project_root = path.resolve(__dirname);
const venv_dir = os.platform() === 'win32'
  ? path.join(project_root, 'venv', 'Scripts')
  : path.join(project_root, 'venv', 'bin');

// Default path to the Python script
const default_script_path = path.join(project_root, 'src', 'main.py');

/**
 * Runs the Python analysis script in the project venv and logs timing.
 * @param {string} [script_path=default_script_path]
 * @returns {Promise<string>} Resolves with stdout.
 */
async function execute_run_python_event_reports(script_path = default_script_path) {
  const start = Date.now();
  run_timer('get_data');

  // Determine the exact python binary in the venv
  const pyBin = path.join(
    venv_dir,
    os.platform() === 'win32' ? 'python.exe' : 'python'
  );

  console.log(`Expecting Python at: ${pyBin}`);

  // Fail early if the venv python doesn’t exist
  if (!fs.existsSync(pyBin)) {
    console.error(
      `ERROR: Virtual‐env Python not found at:\n  ${pyBin}\n` +
      `Please run from project root:\n  python -m venv venv`
    );
    process.exit(1);
  }

  try {
    // Invoke the venv python explicitly
    const { stdout, stderr } = await exec_async(
      `"${pyBin}" "${script_path}"`,
      { env: { ...process.env, PATH: `${venv_dir}${path.delimiter}${process.env.PATH}` } }
    );

    const duration = ((Date.now() - start) / 1000).toFixed(2);
    console.log(`⏳ ${path.basename(script_path)} took ${duration} seconds`);

    if (stderr) console.warn('⚠️ Python stderr:', stderr.trim());
    console.log('📄 Python stdout:\n', stdout.trim());

    return stdout.trim();

  } catch (error) {
    console.error('❌ Failed to run Python script:', error.message);
    throw error;

  } finally {
    stop_timer('get_data');
  }
}

// If invoked directly, run immediately
if (require.main === module) {
  execute_run_python_event_reports().catch(() => process.exit(1));
}

// Export for use elsewhere
module.exports = { execute_run_python_event_reports };
