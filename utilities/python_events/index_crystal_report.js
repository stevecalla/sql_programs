// index_crystal_report.js
// Launches the Crystal-report main.py under your project venv

const { exec } = require('child_process');
const util = require('util');
const exec_async = util.promisify(exec);
const path = require('path');
const os = require('os');
const { runTimer: run_timer, stopTimer: stop_timer } = require('../../utilities/timer');

// 1) Locate project root and venv bin folder
const project_root = path.resolve(__dirname);
const venv_dir = os.platform() === 'win32'
  ? path.join(project_root, 'venv', 'Scripts')
  : path.join(project_root, 'venv', 'bin');

// 2) Prepend venv to PATH so `python` points inside your venv
const env = {
  ...process.env,
  PATH: `${venv_dir}${path.delimiter}${process.env.PATH}`
};

// 3) Point at your Crystal-report entry script
const default_script_path = path.join(
  project_root,
  'src',
  'crystal_reports_main.py'
);

async function run_crystal_report(script_path = default_script_path) {
  const start = Date.now();
  run_timer('get_data');

  console.log(
    `Using Python from venv: ${path.join(
      venv_dir,
      os.platform() === 'win32' ? 'python.exe' : 'python'
    )}`
  );

  try {
    // Note: we call `python` (not python3) so it resolves to the venv python
    const { stdout, stderr } = await exec_async(
      `python3 "${script_path}"`,
      { env }
    );

    const duration = ((Date.now() - start) / 1000).toFixed(2);
    console.log(`⏳ ${path.basename(script_path)} took ${duration} seconds`);

    if (stderr) console.warn('⚠️ Python stderr:', stderr);
    console.log('📄 Output from script:\n', stdout.trim());
  } catch (error) {
    console.error('❌ Failed to run process in main.py:', error.message);
    process.exit(1);
  } finally {
    stop_timer('get_data');
  }
}

// Auto-run if invoked directly
if (require.main === module) {
  run_crystal_report();
}

module.exports = { run_crystal_report };
