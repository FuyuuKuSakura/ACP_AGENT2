const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('dionysus', {
  platform: process.platform,
})
