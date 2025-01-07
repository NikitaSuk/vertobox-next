// pages/index.tsx
import React from 'react';
import PriceChart from '@/components/PriceChart';

const Home: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-gray-800 to-gray-900 text-white p-4">
      <h1 className="text-2xl font-bold mb-4">Bitcoin Price Chart</h1>
      <PriceChart symbol="BTC-USD" />
    </div>
  );
};

export default Home;