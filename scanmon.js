// scanmon.js
const inquirer = require('inquirer');
const { checkSudo, checkSystemCompatibility, ensureDirectories, checkAndInstallDependencies, checkClamAVConfig, checkDirectoryPermissions, getVulnerableDirectories } = require('./utils');
const { updateDatabase, runScan, countFiles } = require('./scanner');
const os = require('os');

const APP_NAME = "ScanMon";
const LAST_UPDATED = "2024-09-01";
const SCAN_TIMEOUT = 600000; // 10 minute timeout

console.log(`Welcome to ${APP_NAME}!`);
console.log(`This application uses ClamAV and Freshclam for virus scanning and database updates.`);
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

    const { updateChoice } = await inquirer.prompt([
      {
        type: 'list',
        name: 'updateChoice',
        message: 'Do you want to update the ClamAV database?',
        choices: ['Yes', 'No, I have manually updated it', 'Skip update and continue with scan']
      }
    ]);

    if (updateChoice === 'Yes') {
      try {
        await updateDatabase();
      } catch (dbError) {
        console.log("Error updating database. You may need to update manually.");
        console.log("Run: sudo freshclam");
        console.log("Then run this script again and choose 'No, I have manually updated it'.");
        process.exit(1);
      }
    } else if (updateChoice === 'No, I have manually updated it') {
      console.log("Skipping database update as it has been manually updated.");
    } else {
      console.log("Skipping database update. Note that this may affect scan accuracy.");
    }

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
