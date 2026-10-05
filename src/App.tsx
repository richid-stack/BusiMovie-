import React from "react";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import UserStorefront from "./pages/UserStorefront";
import AdminDashboard from "./pages/AdminDashboard";

export default function App() {
  return (
    <BrowserRouter>
      {/* 
        A discreet way for Admins to navigate to the console. 
        In a real app, this would be behind authentication.
      */}
      <div className="fixed bottom-4 right-4 z-[9999]">
        <Link 
          to="/admin" 
          className="w-10 h-10 rounded-full bg-zinc-900/50 hover:bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-500 hover:text-white backdrop-blur-md transition shadow-2xl opacity-50 hover:opacity-100"
          title="Admin Console"
        >
          ⌘
        </Link>
      </div>

      <Routes>
        <Route path="/" element={<UserStorefront />} />
        <Route path="/admin" element={<AdminDashboard />} />
      </Routes>
    </BrowserRouter>
  );
}
