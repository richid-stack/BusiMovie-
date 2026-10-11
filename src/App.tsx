import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import UserStorefront from "./pages/UserStorefront";
import AdminApp from "./admin/AdminApp";
import AdminGate from "./components/AdminGate";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<UserStorefront />} />
        <Route path="/admin/*" element={<AdminGate><AdminApp /></AdminGate>} />
      </Routes>
    </BrowserRouter>
  );
}
