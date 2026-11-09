import { initializeApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

// Firebase web config identifies the project; access is enforced by Auth and Firestore Rules.
const firebaseConfig = {
  apiKey: "AIzaSyBzkb_dkJXAPhmHoyXrKQyQBhMP5r_K4jw",
  authDomain: "repscentral-analytics.firebaseapp.com",
  projectId: "repscentral-analytics",
  storageBucket: "repscentral-analytics.firebasestorage.app",
  messagingSenderId: "541513873273",
  appId: "1:541513873273:web:37ad294b0594450e1861a8",
  measurementId: "G-N7GZJ7LFGJ"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
