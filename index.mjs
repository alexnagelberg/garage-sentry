import { GoogleGenAI, Type } from "@google/genai";
import * as fs from "node:fs";
import { exec } from 'node:child_process';

const apiKey = '';

const ai = new GoogleGenAI({ apiKey });
const imagePath = '/tmp/garage.jpg';
exec(`fswebcam -r 1280x720 --no-banner ${imagePath}`, async (err) => {

  const base64ImageFile = fs.readFileSync(imagePath, {
    encoding: "base64",
  });

  const contents = [
    {
      inlineData: {
        mimeType: "image/jpeg",
        data: base64ImageFile,
      },
    },
    //{ text: 'Do you see a person or not?' }
    { text: 'Do you see a garage door open or not (true for open/sunlight coming through, false for all closed or pitch black)? How many cars do you see parked (if pitch black, respond with 2)?' }
  ];

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents, 
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          doorOpen: {
            type: Type.BOOLEAN
          },
          carsParked: {
            type: Type.NUMBER
          }
        }
      }
    }
  });
  console.log(response.text);
  const { doorOpen, carsParked } = JSON.parse(response.text)
  console.log(`Door ${doorOpen ? 'open' : 'closed'}`)
  console.log(`Cars: ${carsParked}`)
});
