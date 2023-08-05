const { app, BrowserWindow, ipcMain, Menu, webContents } = require('electron');
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

//let selectedFolderId = '';
//let selectedFolderName = ''// Initialize with the ID of the default folder

// Update the selected folder ID when we receive a new one from the renderer
ipcMain.on('selectedFolderId', (event, folderId, folderName) => {
    selectedPackage = packages.find( p => p.name === folderName );
});

app.on('ready', () => {
    // Create the Electron window
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        icon: path.join(__dirname, 'public/Icon_Logo.png'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            backgroundThrottling: false,
        },
        frame: true,
    });

    // enable dev tools
    //mainWindow.webContents.openDevTools();

    mainWindow.loadFile('index.html');
    const menu = Menu.buildFromTemplate([]);
    Menu.setApplicationMenu(menu);
    mainWindow.on('closed', () => mainWindow = null);
});

// Handler for opening the folder dialog
ipcMain.on('openFolderDialog', (event) => {
    const { dialog } = require('electron');

    dialog
        .showOpenDialog(mainWindow, {
            properties: ['openDirectory'],
        })
        .then((result) => {
            if (!result.canceled && result.filePaths.length > 0) {
                folderPath = path.join(result.filePaths[0], modPath);
                store.set('folderPath', result.filePaths[0]);
                event.reply('folderSelected', result.filePaths[0]);
            }
        })
        .catch((err) => {
            console.error(err);
        });
});


async function generateMD5Checksum(file) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('md5');
        const stream = fs.createReadStream(file);

        stream.on('data', (data) => hash.update(data));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', (error) => reject(error));
    });
}


async function downloadFiles(event) {
    const files = []
    event.reply('buttonText', 'Initializing', true);


    await Promise.all( selectedPackage.files.map( async (file) => {
        const localFilePath = path.join( folderPath, file.path);

        file.localFilePath = localFilePath;
        const needDownload =  !fs.existsSync(localFilePath) || file.md5Checksum !== await generateMD5Checksum(localFilePath)
        if( needDownload ) {
            files.push( file )
        }
    }) );
    event.reply('stopButtonTextAnimation', 'Initializing')

    const sizeToDownload =  files.reduce( (total, file) => total + file.size, 0 )
    if( sizeToDownload === 0 ) {
        event.reply('updateStatus', 'All files are up to date.');
        return;
    }else {
        event.reply('buttonText', 'Downloading', false);
    }



    await Promise.map(files, async (file) => {
        // Ensure the directory exists before creating the write stream
        fs.mkdirSync(path.dirname(file.localFilePath), {recursive: true});
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
                    //console.log(`Downloaded ${file.name} ${fileProgress}%`)
                    // console.log(`Downloaded ${file.name} ${progressEvent.loaded} / ${file.size}`)
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
            response.data.on('end', () => {
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
                dest.end();
                dest.close();
            })
                .on('error', (err) => {
                    //console.error(`Error ON ERROR ${file.name}: ${err.message}`);
                });
            response.data.pipe(dest);
            return finished(dest);
        } catch (e) {
            return Promise.reject(e);
        }


    }).catch(error => {
        console.error("An error occurred while downloading files:", error);
        mainWindow.webContents.send('updateStatus', 'Google API error occurred.');
    });
}
ipcMain.on('getFileStructure', async (event) => {
    try {
        const response = await axios.get(`${serverUrl}/files`)
        packages = response.data;
        event.sender.send('subfoldersFetched', packages );
        accessToken = (await axios.get(`${serverUrl}/token`)).data
    } catch (err) {
        console.error('Failed to fetch subfolders:', err);
    }
});
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

// Handler for updating files
ipcMain.on('updateFiles', async (event) => {
    if (!folderPath) {
        event.reply('updateStatus', 'Please select a folder first!');
        return;
    }

    event.reply('clean' , true);

    totalFilesSize = selectedPackage.totalSize


    if (totalFilesSize === 0) {
        event.reply('updateStatus', 'All files are up to date!');
        event.reply('clean' , false);
        event.reply('stopButtonTextAnimation', 'Install')
        return 'All files are up to date!';
    } else {
        await downloadFiles(event);
        if(totalDownloadedBytes>0){
            event.reply('updateStatus', `Version ${selectedPackage.name} installed`);
        }
        event.reply('buttonText', 'Patch', false);
        event.reply('clean' , false);

        totalFilesSize = 0;
        totalDownloadedBytes = 0;

        return 'Files updated successfully!';
    }

});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Electron app ready event
