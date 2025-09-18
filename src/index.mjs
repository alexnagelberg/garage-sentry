import { GoogleGenAI, Type } from '@google/genai'
import { exec } from 'node:child_process'
import { readFileSync } from 'fs'
import { importPKCS8, SignJWT } from 'jose'

import axios from 'axios'

// TODO: put in cron

const apiKey = ''

const ai = new GoogleGenAI({ apiKey })
const imagePath = '/tmp/garage.jpg'
exec(`fswebcam -r 1280x720 --no-banner ${imagePath}`, async err => {
  const base64ImageFile = readFileSync(imagePath, {
    encoding: 'base64'
  })

  const contents = [
    {
      inlineData: {
        mimeType: 'image/jpeg',
        data: base64ImageFile
      }
    },
    //{ text: 'Do you see a person or not?' }
    //    { text: 'Do you see a garage door open or not (true for open/sunlight coming through, false for all closed or pitch black)? How many cars do you see parked (if pitch black, respond with 2)?' }
    {
      text: 'Do you see a garage door open or not on the left and on the right (true for open/sunlight coming through, false for closed or pitch black)? Do you see a car parked on the left and on the right (true for both if pitch black)'
    }
  ]

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          leftDoorOpen: {
            type: Type.BOOLEAN
          },
          rightDoorOpen: {
            type: Type.BOOLEAN
          },
          leftCarParked: {
            type: Type.BOOLEAN
          },
          rightCarParked: {
            type: Type.BOOLEAN
          }
        }
      }
    }
  })
  console.log(response.text)
  const { leftDoorOpen, rightDoorOpen, leftCarParked, rightCarParked } = JSON.parse(response.text)
  const payload = {
    image: base64ImageFile,
    leftDoorOpen,
    rightDoorOpen,
    leftCarParked,
    rightCarParked
  }

  const alg = 'RS256'
  const privateKey = await importPKCS8(readFileSync('private.key').toString(), alg)
  const jwt = await new SignJWT({ prop: 'value' })
    .setProtectedHeader({ alg })
    .setIssuedAt()
    .setExpirationTime('1 minute')
    .sign(privateKey)

  await axios.post('https://nagelberg.dev/api/garage', payload, { headers: { Authorization: `Bearer ${jwt}` } })
})
