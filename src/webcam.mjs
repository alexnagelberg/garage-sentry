import { exec } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { importPKCS8, SignJWT } from 'jose'
import axios from 'axios'
import { host, workingDirectory } from './config.mjs'

const imagePath = '/tmp/webcam.jpg'

exec(`fswebcam -r 1280x720 --no-banner ${imagePath}`, async err => {  
  const alg = 'RS256'
  const privateKey = await importPKCS8(readFileSync(`${workingDirectory}/private.key`).toString(), alg)
  const jwt = await new SignJWT({ prop: 'value' })
    .setProtectedHeader({ alg })
    .setIssuedAt()
    .setExpirationTime('1 minute')
    .sign(privateKey)
  const payload = { image: readFileSync(imagePath, { encoding: 'base64' }) }
  await axios.post(`https://${host}/api/garage`, payload, {
    headers: { Authorization: `Bearer ${jwt}` }
  })
})
