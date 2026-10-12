# Face Recognition Attendance System

This repository contains a Next.js frontend, a Flask face-recognition API, and legacy desktop attendance scripts.

## Run the web app locally

Use Python 3.11 for the backend. The face-recognition dependencies are not compatible with the Python 3.14 environment used during development.

If `backend/.env` does not exist, create it from `backend/.env.example`, then set `MONGODB_URI` to your MongoDB connection string. Keep that file private.

From the repository root, start the backend:

```powershell
if (-not (Test-Path backend\.env)) { Copy-Item backend\.env.example backend\.env }
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements.txt
python backend\app.py
```

In a second terminal, start the frontend:

```powershell
cd frontend
npm ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm run dev
```

Open `http://localhost:3000`. The backend starts listening while its face-recognition models warm up; registration and recognition return `503` until `/health` reports `ready`. First startup can take several minutes.

The root `requirements.txt` is for the legacy desktop scripts. The Flask service uses `backend/requirements.txt`.

## Deploy to Render

1. Push the repository to GitHub after reviewing which files and history will be published.
2. In Render, create a Blueprint and select the repository containing `render.yaml`.
3. Provide `MONGODB_URI` when prompted. The Blueprint creates the frontend and backend and connects their deployed URLs.
4. Wait for backend model initialization and confirm `/health` reports `ready` before trying recognition.

The backend Blueprint uses a paid `1c-2g` instance because TensorFlow and the face models exceed Render's 512 MB free instance. Check Render pricing before creating it. MongoDB Atlas must allow connections from Render; use a limited database user and suitable network access rules.

The frontend needs HTTPS for camera access outside localhost. If you deploy without the Blueprint, set `NEXT_PUBLIC_API_URL` to the backend's public URL.

## Security

Never commit `.env` files, database credentials, student records, or trained face data. A MongoDB credential was found in a legacy source file and has been removed; rotate it in MongoDB Atlas before publishing. The credential may remain in earlier Git commits, so rotating it is essential even if you remove it from history.

[![forthebadge made-with-python](http://ForTheBadge.com/images/badges/made-with-python.svg)](https://www.python.org/)                 
[![Python 3.9](https://img.shields.io/badge/python-3.9-blue.svg)](https://www.python.org/downloads/release/python-390/) 

### Legacy desktop workflow
- Download or clone my Repository to your device
- type `pip install -r requirements.txt` in command prompt(this will install required package for project)
- Create a `TrainingImage` folder in a project folder.
- open `attendance.py` and `automaticAttendance.py`, change all the path according to your system
- Run `attandance.py` file

### Project flow & explaination
- After you run the project you have to register your face so that system can identify you, so click on register new student
- After you click a small window will pop up in that you have to enter you ID and name and then click on `Take Image` button
- After clicking `Take Image` button A camera window will pop up and it will detect your Face and take upto 50 Images(you can change the number of Image it can take) and stored in the folder named `TrainingImage`. more you give the image to system, the better it will perform while recognising the face.
- Then you have to click on `Train Image` button, It will train the model and convert all the Image into numeric format so that computer can understand. we are training the image so that next time when we will show the same face to the computer it will easily identify the face.
- It will take some time(depends on you system).
- After training model click on `Automatic Attendance` ,you have to enter the subject name and then it can fill attendace by your face using our trained model.
- it will create `.csv` file for every subject you enter and seperate every `.csv` file according the subject
- You can view the attendance after clicking `View Attendance` button. It will show record in tabular format.
## Just follow me and Star⭐ my repository
