import { GoogleGenAI, Type } from '@google/genai'
import { Ollama } from 'ollama'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync } from 'fs'
import { importPKCS8, SignJWT } from 'jose'
import { pushoverKey, pushoverUserKeys, genApiKey, workingDirectory, imagePath, model, host } from './config.mjs'
import axios from 'axios'

const snoozeInterval = 60 * 60 * 1000 // 1 hour
const interval = 5 * 60 * 1000 // 5 minutes
//const interval = 30 * 60 * 1000 // 30 minutes for gemini

const execAsync = promisify(exec)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

const ai = new GoogleGenAI({ apiKey: genApiKey })
// TOOD: clean up ollama object, try catches, etc. in main loop
const sendNotification = async (message, image, door) => {
  const alg = 'RS256'
  const privateKey = await importPKCS8(readFileSync(`${workingDirectory}/private.key`).toString(), alg)
  const jwt = await new SignJWT({ prop: 'value' })
    .setProtectedHeader({ alg })
    .setIssuedAt()
    .setExpirationTime('1 minute')
    .sign(privateKey)
  await axios.post(
    `https://${host}/api/garage/push/notify`,
    { message, door },
    { headers: { Authorization: `Bearer ${jwt}` } }
  )
  /*for await (const userKey of pushoverUserKeys) {
    try {
      await axios.post('https://api.pushover.net/1/messages.json', {
        token: pushoverKey,
        user: userKey,
        message,
        attachment_type: 'image/jpeg',
        attachment_base64: image,
        url: 'https://nagelberg.dev/garage'
      })
    } catch (e) {
      console.error('Error sending pushover notification', e)
    }
  }*/
}

const runGemini = async imagePath => {
  const currentSnapshot = readFileSync(imagePath, { encoding: 'base64' })
  const contents = [
    {
      inlineData: {
        mimeType: 'image/jpeg',
        data: currentSnapshot
      }
    },
    //    { text: 'Do you see a garage door open or not (true for open/sunlight coming through, false for all closed or pitch black)? How many cars do you see parked (if pitch black, respond with 2)?' }
    {
      text: 'Do you see a garage door fully open or not on the left? on the right (true for open wih outside coming through, false for closed or room is pitch black)? Do you see a car parked on the left and on the right (true for both if pitch black)?'
    }
  ]

  const response = await ai.models.generateContent({
    model,
    contents,
    config: {
      thinkingConfig: {
        thinkingBudget: -1
      },
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

  return { leftDoorOpen, rightDoorOpen, leftCarParked, rightCarParked }
}

const runOllama = async imagePath => {
  const ollama = new Ollama({ host: 'http://rosie.local:11434' })
  /*const prompt =
    'is there a car parked on the left/right (true if image is black)? is the garage door open on the left/right (false if image is black)?'*/
  const prompt = `
The image shows two garage doors.

Rules:
- leftDoorOpen: true if the left garage door is visibly open, otherwise false.
- rightDoorOpen: true if the right garage door is visibly open, otherwise false.
- leftCarParked: true if a car is visible in or directly in front of the left garage bay, otherwise false.
- rightCarParked: true if a car is visible in or directly in front of the right garage bay, otherwise false.
- Use only the current image.
`

  const outputPrompt =
    'output to JSON { "leftDoorOpen": BOOLEAN, "rightDoorOpen": BOOLEAN, "leftCarParked": BOOLEAN, "rightCarParked": BOOLEAN }'
  const response = await ollama.chat({
    //      model: 'gemma3',
    //model: 'qwen3-vl:4b',
    //model: 'qwen3-vl:8b',
    model: 'qwen3.5:4b',
    format: 'json',
    messages: [
      {
        role: 'system',
        content: 'Classify this fixed garage webcam image.'
      },
      {
        role: 'user',
        content: prompt,
        images: [imagePath]
      },
      {
        role: 'user',
        content: outputPrompt
      }
    ]
  })
  console.log(`Summary: ${response.message.thinking}`)
  //console.log(response.message.content)
  //console.log(response.message.content.doorOpenLeft)
  const { leftDoorOpen, rightDoorOpen, leftCarParked, rightCarParked } = JSON.parse(response.message.content)

  return { leftDoorOpen, rightDoorOpen, leftCarParked, rightCarParked }
}

// TODO: shove in try/catch
const runIteration = async () => {
  // Check if snoozed
  const { data: activeData } = await axios.get(`https://${host}/api/garage/active`)
  if (!activeData.active) {
    console.log('Snoozing.')
    return snoozeInterval
  }

  await execAsync(`fswebcam -r 1280x720 --no-banner ${imagePath}`)

  // const { leftDoorOpen, rightDoorOpen, leftCarParked, rightCarParked } = await runGemini(imagePath)
  const { leftDoorOpen, rightDoorOpen, leftCarParked, rightCarParked } = await runOllama(imagePath)

  const currentSnapshot = readFileSync(imagePath, { encoding: 'base64' })
  const payload = {
    image: currentSnapshot,
    leftDoorOpen,
    rightDoorOpen,
    leftCarParked,
    rightCarParked
  }

  /*const leftDoorOpen = true
  const rightDoorOpen = false
  const leftCarParked = false
  const rightCarParked = true
  const currentSnapshot = readFileSync('/tmp/garage.jpg', { encoding: 'base64' })
  const payload = { leftDoorOpen, rightDoorOpen, leftCarParked, rightCarParked, image: currentSnapshot }*/
  const alg = 'RS256'
  const privateKey = await importPKCS8(readFileSync(`${workingDirectory}/private.key`).toString(), alg)
  const jwt = await new SignJWT({ prop: 'value' })
    .setProtectedHeader({ alg })
    .setIssuedAt()
    .setExpirationTime('1 minute')
    .sign(privateKey)

  const { data } = await axios.post(`https://${host}/api/garage`, payload, {
    headers: { Authorization: `Bearer ${jwt}` }
  })

  if (leftDoorOpen && !leftCarParked && data.leftDoorOpen) {
    console.log('Left door open and no car parked!')
    try {
      await sendNotification('Left door open and no car parked!', currentSnapshot, 'left')
    } catch (e) {
      console.error('Error sending left notification', e)
    }
  }
  if (rightDoorOpen && !rightCarParked && data.rightDoorOpen) {
    console.log('Right door open and no car parked!')
    try {
      await sendNotification('Right door open and no car parked!', currentSnapshot, 'right')
    } catch (e) {
      console.error('Error sending right notification', e)
    }
  }

  return interval
}

const mainLoop = async () => {
  while (true) {
    let nextDelay = interval
    try {
      nextDelay = await runIteration()
    } catch (e) {
      console.error('Iteration failed', e)
    }

    await delay(nextDelay)
  }
}

process.on('unhandledRejection', e => {
  console.error('Unhandled promise rejection', e)
})

process.on('uncaughtException', e => {
  console.error('Uncaught exception', e)
})

void mainLoop()

// TODO: instead of reading last value, set a timeout and run again in 5 minutes (if still open and no car, send notification)
