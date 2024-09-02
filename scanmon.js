// scanmon.js
const inquirer = require('inquirer');
const { checkSudo, checkSystemCompatibility, ensureDirectories, checkAndInstallDependencies, checkClamAVConfig, checkDirectoryPermissions, getVulnerableDirectories, getDatabaseAge } = require('./utils');
const { runScan, countFiles } = require('./scanner');
const os = require('os');
const { spawn } = require('child_process');

const APP_NAME = "ScanMon";
const LAST_UPDATED = "2024-09-01";
const SCAN_TIMEOUT = 600000; // 10 minute timeout

console.log(`Welcome to ${APP_NAME}!`);
console.log(`This application uses ClamAV for virus scanning.`);
console.log(`Last updated: ${LAST_UPDATED}\n`);

let currentScanProcess = null;

function cleanup() {
  if (currentScanProcess) {
    currentScanProcess.kill();
  }
  console.log("\nScan aborted. Exiting...");
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

async function checkAndPromptDatabaseUpdate() {
  const dbPath = os.platform() === 'darwin' 
    ? '/opt/homebrew/var/lib/clamav/main.cvd'
    : '/var/lib/clamav/main.cvd';
  
  const ageInDays = await getDatabaseAge(dbPath);

  if (ageInDays === null) {
    console.log("Unable to check database age. You may need to update manually.");
    return;
  }

  console.log(`ClamAV database is approximately ${ageInDays.toFixed(1)} days old.`);

  if (ageInDays > 7) {
    console.log("Your database is more than a week old. It's recommended to update.");
    const { shouldUpdate } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'shouldUpdate',
        message: 'Do you want to update the database now?',
        default: true
      }
    ]);

    if (shouldUpdate) {
      console.log("Updating database. This may take a few minutes...");
      const updateProcess = spawn('node', ['update-database.js'], { stdio: 'inherit' });
      await new Promise((resolve) => {
        updateProcess.on('close', (code) => {
          if (code === 0) {
            console.log("Database updated successfully.");
          } else {
            console.log("Database update failed. You may need to run 'sudo freshclam' manually.");
          }
          resolve();
        });
      });
    } else {
      console.log("Skipping database update. Note that this may affect scan accuracy.");
    }
  } else {
    console.log("Your database is up to date.");
  }
}

async function main() {
  try {
    checkSudo();
    checkSystemCompatibility();
    await ensureDirectories();
    await checkAndInstallDependencies();
    await checkClamAVConfig();

    const clamavDir = os.platform() === 'darwin' 
      ? '/opt/homebrew/var/lib/clamav' 
      : '/var/lib/clamav';
    await checkDirectoryPermissions(clamavDir);

    await checkAndPromptDatabaseUpdate();

    const vulnerableDirectories = getVulnerableDirectories();
    const { scanChoice } = await inquirer.prompt([
      {
        type: 'list',
        name: 'scanChoice',
        message: 'Choose a scan option:',
        choices: [
          ...Object.keys(vulnerableDirectories).map(key => ({ name: key, value: key })),
          { name: 'Custom path', value: 'custom' }
        ]
      }
    ]);

    let scanPaths = [];
    if (scanChoice === 'custom') {
      const { customPath } = await inquirer.prompt([
        {
          type: 'input',
          name: 'customPath',
          message: 'Enter the custom path you want to scan:',
          default: process.cwd(),
        }
      ]);
      scanPaths = [customPath];
    } else {
      scanPaths = vulnerableDirectories[scanChoice];
    }

    console.log("Press Ctrl+C at any time to abort the scan.");

    let totalInfectedFiles = 0;
    let totalDuration = 0;
    let scanAborted = false;

    for (const scanPath of scanPaths) {
      if (scanAborted) break;

      try {
        const scanResult = await runScan(scanPath, SCAN_TIMEOUT);
        currentScanProcess = scanResult.process;
        
        if (scanResult.aborted) {
          console.log("\nScan aborted or timed out.");
          scanAborted = true;
        } else {
          const infectedFiles = (scanResult.output.match(/Infected files: (\d+)/) || [])[1] || '0';
          totalInfectedFiles += parseInt(infectedFiles, 10);
          totalDuration += parseFloat(scanResult.duration);
          
          console.log(`\nScan of ${scanPath} complete.`);
          console.log(`Infected files in this directory: ${infectedFiles}`);
          console.log(`Duration: ${scanResult.duration} seconds`);
        }
      } catch (error) {
        console.error(`Error scanning ${scanPath}: ${error.message}`);
        console.log("Continuing with next directory...");
      } finally {
        currentScanProcess = null;
      }
    }

    if (!scanAborted) {
      console.log("\nOverall Scan Summary:");
      console.log(`Total infected files: ${totalInfectedFiles}`);
      
      if (totalInfectedFiles > 0) {
        console.error('\x1b[31m%s\x1b[0m', `WARNING: ${totalInfectedFiles} infected files found in total!`);
      } else {
        console.log('\x1b[32m%s\x1b[0m', "No infections found in any scanned directories.");
      }

      console.log(`Total scan duration: ${totalDuration.toFixed(2)} seconds`);
    }

    console.log("Execution complete.");
  } catch (error) {
    console.log("An error occurred:", error.message);
    console.log("Please check the above logs for more information on the error.");
    console.log("If the issue persists, you may need to manually check your ClamAV installation and configuration.");
  } finally {
    cleanup();
  }
}

main();
