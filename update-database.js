const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

async function getDatabaseAge(dbPath) {
  try {
    const stats = await fs.stat(dbPath);
    const ageInDays = (Date.now() - stats.mtime) / (1000 * 60 * 60 * 24);
    return ageInDays;
  } catch (error) {
    console.error(`Error checking database: ${error.message}`);
    return null;
  }
}

async function updateDatabase() {
  return new Promise((resolve, reject) => {
    exec('sudo freshclam', (error, stdout, stderr) => {
      if (error) {
        console.error(`Error: ${error.message}`);
        return reject(error);
      }
      if (stderr) {
        console.error(`stderr: ${stderr}`);
        return reject(new Error(stderr));
      }
      console.log(`stdout: ${stdout}`);
      resolve(stdout);
    });
  });
}

async function main() {
  const dbPath = '/var/lib/clamav/main.cvd'; // Adjust this path if necessary for your system
  const ageInDays = await getDatabaseAge(dbPath);

  if (ageInDays === null) {
    console.log("Unable to check database age. You may need to update manually.");
    return;
  }

  console.log(`ClamAV database is approximately ${ageInDays.toFixed(1)} days old.`);

  if (ageInDays > 7) {
    console.log("Your database is more than a week old. It's recommended to update.");
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });

    readline.question('Do you want to update the database now? (y/n) ', async (answer) => {
      if (answer.toLowerCase() === 'y') {
        try {
          await updateDatabase();
          console.log("Database updated successfully.");
        } catch (error) {
          console.error("Failed to update database. You may need to run 'sudo freshclam' manually.");
        }
      } else {
        console.log("Skipping database update. Note that this may affect scan accuracy.");
      }
      readline.close();
    });
  } else {
    console.log("Your database is up to date.");
  }
}

main();
