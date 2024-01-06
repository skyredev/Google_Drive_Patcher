const { app, BrowserWindow, ipcMain, Menu, webContents, dialog, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const Promise = require('bluebird');
const axios = require('axios');
const Store = require('electron-store');
const crypto = require('crypto');
const  { promisify }  = require( 'util');
const stream = require('stream');
const finished = promisify(stream.finished);

let mainWindow, folderPath;
let totalDownloadedBytes = 0;
const modPath = 'Mods/Resurgence of the Storm/Release';
const serverUrl = 'http://44.193.59.229:5000';
const store = new Store();
let totalFilesSize = 0;
let packages;
let selectedPackage
let accessToken = '';
const files = []
let sizeToDownload = 0;
let isDevMode = null;

//let selectedFolderId = '';
//let selectedFolderName = ''// Initialize with the ID of the default folder



app.on('ready', () => {
    // Create the Electron window
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        icon: path.join(__dirname, 'public/Icon_Logo.png'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            //backgroundThrottling: false,
        },
        frame: true,
    });
    mainWindow.setMinimumSize(800, 600);
    // enable dev tools
    //mainWindow.webContents.openDevTools();
    isDevMode = process.defaultApp




    mainWindow.loadFile('index.html');
    const menu = Menu.buildFromTemplate([]);
    Menu.setApplicationMenu(menu);
    mainWindow.on('close', (e) => {
        e.preventDefault();

        const choice = dialog.showMessageBoxSync(mainWindow, {
            type: 'question',
            buttons: ['Yes', 'No'],
            title: 'Confirm',
            message: 'Are you sure you want to quit?'
        });

        if (choice === 0) { //// index of 'Yes' button
            mainWindow.destroy(); // this will close the app
        }
    });
});


// Functions

async function shouldDownloadFile(file) {
    const localFilePath = path.join(folderPath, file.path);
    //const fileInfo = store.get(file.id);
    const fileInfo = store.get(file.name);

    if (!fs.existsSync(localFilePath)) {
        return true;
    }

    if (fileInfo) {
        if (file.md5Checksum !== fileInfo.md5Checksum) {
            return true;
        }

        /*        const stat = fs.statSync(localFilePath);
                if (fileInfo.lastModified !== stat.mtime.getTime()) {
                    return true;
                }*/     // Current version of patcher includes this part, decided to turn it off, cause sometimes I saw redundant downloads due to this check, so now it's only be the checksum

        return false;
    }

    return true;
}
async function updateStoreAfterDownload(file) {
    const localFilePath = path.join(folderPath, file.path);
    const stat = fs.statSync(localFilePath);

    const fileInfo = {
        md5Checksum: file.md5Checksum,
        lastModified: stat.mtime.getTime(),
    };
    store.set(file.name, fileInfo);
}
async function downloadFiles(event) {
    const maxConcurrentDownloads = 5;
    const retryAttempts = 3; // Maximum number of retry attempts per file

    await Promise.map(files, async (file) => {
        // Ensure the directory exists before creating the write stream
        fs.mkdirSync(path.dirname(file.localFilePath), { recursive: true });

        let retryCount = 0;
        let downloadSuccess = false;

        while (retryCount < retryAttempts && !downloadSuccess) {
            try {
                // Build the URL with the file ID
                const url = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`;

                // Make the HTTP request with the access token
                const response = await axios.get(url, {
                    headers: {
                        'Authorization': 'Bearer ' + accessToken // The access token you received from the server
                    },
                    responseType: 'stream',
                    onDownloadProgress: (progressEvent) => {
                        totalDownloadedBytes += progressEvent.bytes;
                        // Send the overall progress
                        const overallProgress = (totalDownloadedBytes / sizeToDownload) * 100;
                        webContents.getAllWebContents().forEach((contents) => {
                            contents.send('downloadProgress', { fileName: file.name, progress: overallProgress, downloaded: totalDownloadedBytes, total: sizeToDownload });
                        });
                        const fileProgress = (progressEvent.loaded / parseInt(file.size)) * 100;
                        webContents.getAllWebContents().forEach((contents) => {
                            contents.send('downloadProgressSingleFile', {
                                fileName: file.name,
                                progress: fileProgress,
                                downloadedBytes: progressEvent.loaded,
                                totalSizeBytes: file.size
                            });
                        });
                    }
                });

                const dest = fs.createWriteStream(file.localFilePath);

                await new Promise((resolve, reject) => {
                    response.data
                        .on('end', () => {
                            // Manually set the progress to 100%
                            webContents.getAllWebContents().forEach((contents) => {
                                contents.send('downloadProgressSingleFile', {
                                    fileName: file.name,
                                    progress: 100,
                                    downloadedBytes: file.size,
                                    totalSizeBytes: file.size
                                });
                            });
                            //console.log(`Downloaded ON END ${file.name}`);
                            files.splice(files.indexOf(file), 1); // remove file from array
                            dest.close();
                            dest.end();
                            downloadSuccess = true;
                            resolve();
                        })
                        .on('error', (err) => {
                            console.error(`Error downloading ${file.name}: ${err.message}`);
                            reject(err);
                        });

                    response.data.pipe(dest);
                });

                await updateStoreAfterDownload(file);
            } catch (e) {
                // Handle the error and retry if necessary
                console.error(`Download failed for ${file.name}. Retrying...`);
                retryCount++;
            }
        }

        if (!downloadSuccess) {
            // Handle the case where the download repeatedly fails
            console.error(`Failed to download ${file.name} after ${retryAttempts} attempts.`);
        }
    }, { concurrency: maxConcurrentDownloads }).catch(error => {
        console.error("An error occurred while downloading files:", error);
        mainWindow.webContents.send('updateStatus', 'Error: #FTD_1 - Please try again later or install manually.');
    });
}
async function initDownload(event) {

    event.reply('buttonText', 'Initializing', true);


    let checkedFiles = 0;
    let filesToDownload = 0;
    files.length = 0;
    await Promise.all(
        selectedPackage.files.map(async (file) => {
            file.localFilePath = path.join(folderPath, file.path);

            if (await shouldDownloadFile(file)) {
                filesToDownload++;
                files.push(file);
            }
        })
    );
/*    await Promise.all( selectedPackage.files.map( async (file) => {
        const localFilePath = path.join( folderPath, file.path);

        file.localFilePath = localFilePath;
        const needDownload =  !fs.existsSync(localFilePath) || file.md5Checksum !== await generateMD5Checksum(localFilePath)
        checkedFiles++;
        sendUpdateMessage(event, `Files Checked: ${checkedFiles}/${selectedPackage.files.length}\nFiles to download: ${filesToDownload}`, "noclean")
        if( needDownload ) {
            filesToDownload++;
            files.push( file )
        }
    }) );*/
    event.reply('stopButtonTextAnimation', 'Initializing')
    sendUpdateMessage(event, ``, "noclean")
    sizeToDownload =  files.reduce( (total, file) => total + file.size, 0 )
    if( sizeToDownload === 0 ) {
        event.reply('updateStatus', 'All files are up to date.');
    }else {
        event.reply('buttonText', 'Downloading', false);
        await downloadFiles(event);
    }




}
async function fetchToken() {
    const response = await axios.get(`${serverUrl}/token`);
    accessToken = response.data;
}
async function fetchFilesAndToken() {
    const [tokenResponse] = await Promise.all([
        axios.get(`${serverUrl}/token`)
    ]);

    selectedPackage = packages.find(p => p.name === selectedPackage.name);
    accessToken = tokenResponse.data;
    totalFilesSize = selectedPackage.totalSize;
}
function sendUpdateMessage(event, message, buttonText = null) {
    event.reply('updateStatus', message);
    if(buttonText === "noclean"){
        return;
    }
    if(buttonText === "noclean2"){
        event.reply('wrapper', true);
        return;
    }
    event.reply('clean', false);
    if (buttonText) {
        event.reply('stopButtonTextAnimation', buttonText);
    }
}
function finalizeUpdate(event) {
    event.reply('updateStatus', `Version ${selectedPackage.name} installed`);
    event.reply('buttonText', 'Patch', false);
    event.reply('clean', false);

    new Notification({
        title: "Resurgence of the Storm",
        body: "Version " + selectedPackage.name + " installed",
        icon: path.join(__dirname, 'public/Icon_Logo.png')
    }).show()

    totalFilesSize = 0;
    totalDownloadedBytes = 0;
}


// Handlers

ipcMain.on('loadSavedFolderPath', (event) => {
    let selectedFolderPath = store.get('folderPath');
    if(selectedFolderPath === undefined){
        return;
    }
    folderPath = path.join(selectedFolderPath, modPath);
    // console.log(selectedFolderPath);

    // If there's a previously selected folder path, send it to the renderer
    if (selectedFolderPath) {
        event.reply('folderSelected', selectedFolderPath);
    }
});
ipcMain.on('getFileStructure', async (event) => {
    try {
        await fetchToken();
        event.sender.send('clean', true);
        const response = await axios.get(`${serverUrl}/files`)

        packages = response.data;
        if(!packages){
            sendUpdateMessage(event, 'Error: #FTD_3 All sources are temporarily blocked by Google. Please, try again later', 'Patch');
            return;
        }
        event.sender.send('subfoldersFetched', packages );
        console.log(isDevMode)

        if(!isDevMode){
            const version = require('./package.json').version;

            let patcher = await axios.get(`${serverUrl}/patcher`);
            patcher = patcher.data;

            const patcherVersion = patcher[0].version;

            if (patcherVersion !== version) {
                sendUpdateMessage(event, 'Patcher is outdated.\n\nPlease download the latest version: https://drive.google.com/drive/folders/1aFyXPlDKqp7Zo6Lnn9VxNVOxFE9mOkLI', 'noclean2');
            }
            else event.sender.send('clean', false);
        }else {
            event.sender.send('clean', false);

        }


    } catch (err) {
        console.error('Failed to fetch subfolders:', err);
    }
});
ipcMain.on('openFolderDialog', (event) => {
    const { dialog } = require('electron');

    dialog
        .showOpenDialog(mainWindow, {
            title: 'Select StarCraft II.exe',
            properties: ['openFile'],
            filters: [
                { name: 'StarCraft II', extensions: ['exe'] },
            ],
        })
        .then((result) => {
            if (!result.canceled && result.filePaths.length > 0) {
                const selectedFilePath = result.filePaths[0];
                const directoryPath = path.dirname(result.filePaths[0]);
                const requiredFileName = 'StarCraft II.exe';
                const fileName = path.basename(selectedFilePath);

                if (fileName === requiredFileName) {
                    folderPath = path.join(directoryPath, modPath);
                    store.set('folderPath', directoryPath);
                    event.reply('folderSelected', directoryPath);
                } else {
                    dialog.showErrorBox(
                        'Invalid Selection',
                        `Please find "${requiredFileName}". You can find it by clicking "Show In Explorer" in Battle.net.`
                    );
                }
            }
        })
        .catch((err) => {
            console.error(err);
        });
});
ipcMain.on('selectedFolderId', (event, folderId, folderName) => {
    selectedPackage = packages.find( p => p.name === folderName );
});
ipcMain.on('updateFiles', async (event) => {
    if (!folderPath) {
        return sendUpdateMessage(event, 'Error: #FTD_5 - Please select a folder'); //. Please select a folder first
    }

    //Transfer the store data here
    const primaryData = fs.readFileSync("primary_file_ids.json", 'utf-8');
    const primaryJson = JSON.parse(primaryData);
    const backupData = fs.readFileSync("backup_file_ids.json", 'utf-8');
    const backupJson = JSON.parse(backupData);

    primaryJson.forEach( item => {
        if (item.files && item.files.length > 0) {
            item.files.forEach(file => {
                const id = file.id
                const name = file.name
                let fileInfo = store.get(id, "0");
                if(fileInfo != 0) {
                    store.set(name, fileInfo);
                    store.delete(id);
                    console.log(`Converted file from primary id to name`);
                }
            });
          }
    }
    )

    backupJson.forEach( item => {
        if (item.files && item.files.length > 0) {
            item.files.forEach(file => {
                const id = file.id
                const name = file.name
                let fileInfo = store.get(id, "0");
                if(fileInfo != 0) {
                    store.set(name, fileInfo);
                    store.delete(id);
                    console.log(`Converted file from backup id to name`);
                }
            });
          }
    }
    )

    try {
        event.reply('clean', true);
        await fetchFilesAndToken();

        if (totalFilesSize === 0) {
            return sendUpdateMessage(event, 'Error: #FTD_4', 'Patch');//. Files not found. Please check the stability of your internet connection or contact discord Admin
        }

        await initDownload(event);

        if (sizeToDownload === 0) {
            return sendUpdateMessage(event, 'All files are up to date', 'Patch');
        }
        let i = 0;
        // We already retry three times per download, retrying every download 3x10 times is silly
        while (files.length > 0 && i < 0) {
            console.log(`retry ${i}`)
            i++;
            sizeToDownload =  0
            totalDownloadedBytes = 0
            files.forEach( file => sizeToDownload += file.size )
            await downloadFiles(event);
        }

        if( files.length > 0 ) {
            return sendUpdateMessage(event, 'Error: #FTD_2 - Please try again later or install manually.', 'Patch'); //. Please try to reopen patcher and try again or contact discord Admin
        }
        finalizeUpdate(event);

    } catch (err) {
        // Handle any unexpected errors here.
        console.error(err);
        sendUpdateMessage(event, 'Error: #FTD_3 All sources are temporarily blocked by Google. Please, try again later', 'Patch');
    }
});


app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});


