import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home.jsx';
import MarketDetail from './pages/MarketDetail.jsx';

export default function App() {
  return (
    <BrowserRouter basename="/mvp">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/market" element={<MarketDetail />} />
      </Routes>
    </BrowserRouter>
  );
}
