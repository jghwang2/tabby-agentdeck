// Isolated raw PTY receiver: display the UTF-8 bytes actually received.
process.stdin.setRawMode(true)
process.stdin.resume()
let received = Buffer.alloc(0)
console.log('IME_READY')
process.stdin.on('data', data => {
    if (data.includes(3)) process.exit(0)
    received = Buffer.concat([received, data])
    console.log('\r\nIME_HEX:' + received.toString('hex'))
})
