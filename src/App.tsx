import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import UserStorefront from "./pages/UserStorefront";
import AdminDashboard from "./pages/AdminDashboard";
import AdminGate from "./components/AdminGate";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<UserStorefront />} />
        <Route path="/admin" element={<AdminGate><AdminDashboard /></AdminGate>} />
      </Routes>
    </BrowserRouter>
  );
}
