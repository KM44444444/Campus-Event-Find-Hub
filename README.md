# Campus Event & Find Hub

This project contains a Node.js Express backend and an HTML/JS frontend. It has been refactored from a single text file into a functional web application.

## Prerequisites

- Node.js installed on your machine.

## How to Run

1. Open a terminal and start the backend server:
   ```bash
   cd backend
   node server.js
   ```
   The backend will start on `http://localhost:4000`. A default admin user is seeded with email `kshitiz.mandola.cseds.2024@miet.ac.in` and password `12345678`.

2. Open the frontend:
   You can just open `frontend/index.html` in your web browser (e.g., Chrome or Safari) by double-clicking it.
   
   The frontend will automatically connect to the backend API.

## Features

- **Authentication**: Admin and Student logins with JWT.
- **Approvals**: Students must register and wait for an admin to approve their account before they can log in.
- **Events**: Admins can upload events with titles, descriptions, and photos.
- **Lost & Found**: Students can post lost or found items with photos.
- **Password Reset**: Users can reset their password via a simulated OTP popup.
