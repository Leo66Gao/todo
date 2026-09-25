import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

// Public Firebase web configuration, supplied through NEXT_PUBLIC_* variables
// in webapp/.env.local (never committed — see webapp/.env.example).
const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

/** OAuth web client used to request Google Calendar access tokens. */
export const googleWebClientId = process.env.NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "";

export const firebaseConfigured = Boolean(config.apiKey && config.projectId && config.appId);

let cached: { app: FirebaseApp; auth: Auth; db: Firestore } | null = null;

/** Lazily initialised Firebase handles, or null when not configured. */
export function firebase() {
  if (!firebaseConfigured || typeof window === "undefined") return null;
  if (cached) return cached;
  const app = getApps().length ? getApp() : initializeApp(config);
  cached = {
    app,
    auth: getAuth(app),
    // Same named database as the Flutter app (firebase.json → todo-sync).
    db: getFirestore(app, "todo-sync"),
  };
  return cached;
}
