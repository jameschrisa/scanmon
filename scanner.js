const cliProgress = require('cli-progress');
const { spawn } = require('child_process');
const readline = require('readline');
const fs = require('fs').promises;
const path = require('path');

async function updateDatabase() {
  console.log("Updating ClamAV database...");
  const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
  progressBar.start(100, 0);

  return new Promise((resolve, reject) => {
    const freshclam = spawn('sudo', ['freshclam']);
    let output = '';

    freshclam.stdout.on('data', (data) => {
      output += data.toString();
      progressBar.increment(10);
    });

    freshclam.stderr.on('data', (data) => {
      console.error(`Error: ${data}`);
    });

    freshclam.on('close', (code) => {
      progressBar.stop();
      if (code !== 0) {
        reject(new Error(`Database update process exited with code ${code}`));
      } else {
        console.log("Database update complete.");
        resolve(output);
      }
    });
  });
}

async function countFiles(directory) {
  let fileCount = 0;
  const items = await fs.readdir(directory, { withFileTypes: true });
  for (const item of items) {
    if (item.isDirectory()) {
      fileCount += await countFiles(path.join(directory, item.name));
    } else {
      fileCount++;
    }
  }
  return fileCount;
}

async function runScan(scanPath, timeout) {
  const totalFiles = await countFiles(scanPath);
  console.log(`Found ${totalFiles} files to scan in ${scanPath}`);
  
  const progressBar = new cliProgress.SingleBar({
    format: 'Scanning: [{bar}] {percentage}% | {value}/{total} Files',
    clearOnComplete: false,
    stopOnComplete: true,
    hideCursor: true,
  }, cliProgress.Presets.shades_classic);

  progressBar.start(totalFiles, 0);

  return new Promise((resolve, reject) => {
    const scan = spawn('clamscan', ['-r', '--verbose', scanPath]);
    let output = '';
    let scannedFiles = 0;
    let aborted = false;
    let scanComplete = false;
    const startTime = Date.now();

    const rl = readline.createInterface({
      input: scan.stdout,
      terminal: false
    });

    const timer = setTimeout(() => {
      if (!scanComplete) {
        console.log('\nScan timed out.');
        aborted = true;
        scan.kill();
      }
    }, timeout);

    rl.on('line', (line) => {
      output += line + '\n';
      if (line.includes('Scanning')) {
        scannedFiles++;
        progressBar.update(scannedFiles);
      } else if (line.includes('FOUND')) {
        console.log('\x1b[31m' + line + '\x1b[0m'); // Print in red
      }
    });

    scan.stderr.on('data', (data) => {
      console.error(`Error: ${data}`);
    });

    scan.on('close', (code) => {
      clearTimeout(timer);
      progressBar.stop();
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      scanComplete = true;
      if (aborted) {
        resolve({ aborted: true, duration, output, process: scan });
      } else if (code !== 0) {
        reject(new Error(`Scan process exited with code ${code}`));
      } else {
        resolve({ aborted: false, duration, output, process: scan });
      }
    });

    scan.on('error', (error) => {
      clearTimeout(timer);
      console.error(`Error spawning clamscan: ${error.message}`);
      reject(error);
    });
  });
}

module.exports = { updateDatabase, runScan, countFiles };
