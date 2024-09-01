// database-updater.js
const { exec } = require('child_process');
const util = require('util');
const cliProgress = require('cli-progress');
const fs = require('fs');
const path = require('path');
const os = require('os');

const execPromise = util.promisify(exec);

async function initializeDatabase() {
  console.log("Initializing ClamAV database...");
  const isMac = os.platform() === 'darwin';
  const clamavDir = isMac ? '/opt/homebrew/var/lib/clamav' : '/var/lib/clamav';

  try {
    // Ensure the ClamAV directory exists and has correct permissions
    if (!fs.existsSync(clamavDir)) {
      console.log(`Creating directory: ${clamavDir}`);
      await execPromise(`sudo mkdir -p ${clamavDir}`);
    }

    console.log(`Setting permissions for ${clamavDir}`);
    await execPromise(`sudo chown -R $(whoami) ${clamavDir}`);
    await execPromise(`sudo chmod -R 755 ${clamavDir}`);

    // Run freshclam with sudo
    console.log("Running freshclam to initialize the database...");
    const { stdout, stderr } = await execPromise('sudo freshclam');
    console.log("ClamAV database initialized successfully.");
    console.log(stdout);
    if (stderr) console.error("Warnings:", stderr);
  } catch (error) {
    console.error("Error initializing ClamAV database:", error.message);
    console.error("Please try running 'sudo freshclam' manually to initialize the database.");
    throw error;
  }
}

async function updateDatabase() {
  console.log("Updating ClamAV database...");
  const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
  progressBar.start(100, 0);

  try {
    // Run freshclam with sudo
    const { stdout, stderr } = await execPromise('sudo freshclam');
    progressBar.stop();
    console.log("Database updated successfully.");
    console.log("Update summary:");
    console.log(stdout);
    if (stderr) console.error("Warnings or errors:", stderr);

    // Check if main.cvd exists before trying to get info
    const isMac = os.platform() === 'darwin';
    const mainCvdPath = isMac 
      ? '/opt/homebrew/var/lib/clamav/main.cvd'
      : '/var/lib/clamav/main.cvd';
    
    if (fs.existsSync(mainCvdPath)) {
      const dbInfo = await execPromise(`sudo sigtool --info ${mainCvdPath}`);
      console.log("\nDatabase Information:");
      console.log(dbInfo.stdout);
    } else {
      console.error(`Unable to find ${mainCvdPath}. The database may not have been initialized properly.`);
    }
  } catch (error) {
    progressBar.stop();
    console.error("Error updating database:", error.message);
    throw error;
  }
}

async function ensureConfigFiles() {
  const isMac = os.platform() === 'darwin';
  let configDir = isMac ? '/opt/homebrew/etc' : '/usr/local/etc';
  const alternativeConfigDir = '/etc';
  const configs = [
    { 
      name: 'freshclam.conf',
      content: `DatabaseMirror database.clamav.net
UpdateLogFile ${isMac ? '/opt/homebrew/var/log/freshclam.log' : '/var/log/freshclam.log'}
LogVerbose false
LogSyslog false
LogFacility LOG_LOCAL6
LogFileMaxSize 2M
LogTime true
Foreground false
Debug false
MaxAttempts 5
DatabaseDirectory ${isMac ? '/opt/homebrew/var/lib/clamav' : '/var/lib/clamav'}
DNSDatabaseInfo current.cvd.clamav.net
ConnectTimeout 30
ReceiveTimeout 30
TestDatabases yes
ScriptedUpdates yes
CompressLocalDatabase no
SafeBrowsing false
Bytecode true`
    },
    {
      name: 'clamd.conf',
      content: `LogFile ${isMac ? '/opt/homebrew/var/log/clamd.log' : '/var/log/clamd.log'}
LogTime true
LogVerbose false
ExtendedDetectionInfo true
LogClean false
LogSyslog false
DetectPUA false
ScanPE true
ScanELF true
DetectBrokenExecutables false
ScanOLE2 true
ScanPDF true
ScanSWF true
ScanXMLDOCS true
ScanHWP3 true
ScanMail true
PhishingSignatures true
PhishingScanURLs true
ScanHTML true
ScanArchive true`
    }
  ];

  async function tryCreateConfig(dir, config) {
    const filePath = path.join(dir, config.name);
    try {
      await execPromise(`sudo mkdir -p ${dir}`);
      await execPromise(`echo "${config.content}" | sudo tee ${filePath} > /dev/null`);
      console.log(`Created ${config.name} in ${dir}`);
      return true;
    } catch (error) {
      console.error(`Error creating ${config.name} in ${dir}:`, error.message);
      return false;
    }
  }

  for (const config of configs) {
    let created = await tryCreateConfig(configDir, config);
    if (!created) {
      console.log(`Trying alternative location: ${alternativeConfigDir}`);
      created = await tryCreateConfig(alternativeConfigDir, config);
    }
    
    if (!created) {
      console.error(`Failed to create ${config.name} in both ${configDir} and ${alternativeConfigDir}`);
      console.error("Please ensure you have the necessary permissions or create the config files manually.");
    }
  }
}

module.exports = { updateDatabase, ensureConfigFiles, initializeDatabase };
