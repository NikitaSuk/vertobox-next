// pages/index.tsx
import React from 'react';
import PriceChart from '@/components/PriceChart';

const Home: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-black text-white p-4">
      <h1 className="text-2xl font-bold mb-4">Price Chart</h1>
      <PriceChart symbol="BTC-USD" />
      <PriceChart symbol="ETH-USD" />
    </div>
  );
};

export default Home;