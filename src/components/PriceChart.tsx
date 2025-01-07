"use client"

import React, { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickData, Time, ColorType, ITimeScaleApi } from 'lightweight-charts';
import axios from 'axios';

interface PriceChartProps {
  symbol: string;
}

interface PriceData extends CandlestickData<Time> {
  time: Time;
}

interface MinuteTracking {
  high: number;
  low: number;
  open: number;
  currentMinute: number;
}

type Interval = {
  label: string;
  seconds: number;
  granularity: number;
};

const INTERVALS: Interval[] = [
  { label: '1 minute', seconds: 60, granularity: 60 },
  { label: '5 minutes', seconds: 300, granularity: 300 },
  { label: '15 minutes', seconds: 900, granularity: 900 },
  { label: '1 hour', seconds: 3600, granularity: 3600 },
  { label: '6 hours', seconds: 21600, granularity: 21600 },
  { label: '1 day', seconds: 86400, granularity: 86400 },
];

const PriceChart: React.FC<PriceChartProps> = ({ symbol = 'BTC-USD' }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [currentMinuteData, setCurrentMinuteData] = useState<PriceData | null>(null);
  const minuteTrackingRef = useRef<MinuteTracking>({
    high: -Infinity,
    low: Infinity,
    open: 0,
    currentMinute: 0
  });
  const [selectedInterval, setSelectedInterval] = useState<Interval>(INTERVALS[0]);
  const candlestickSeriesRef = useRef<any>(null);
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [lastPriceChangePercent, setLastPriceChangePercent] = useState<number | null>(null);
  const [volume24h, setVolume24h] = useState<number | null>(null);
  const [high24h, setHigh24h] = useState<number | null>(null);
  const [low24h, setLow24h] = useState<number | null>(null);
  const intl = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
});

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 400,
      layout: {
        background: {
          type: ColorType.Solid, color: '#00000000'
        },
        textColor: '#FFF'
      },
      grid: {
        vertLines: {
          visible: false
        },
        horzLines: {
          color: '#FFFFFF40'
        }
      }
    });
    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#24AC74',
      downColor: '#F0616D',
      borderUpColor: '#24AC74',
      borderDownColor: '#F0616D',
      wickUpColor: '#24AC74',
      wickDownColor: '#F0616D'
    });
    candlestickSeriesRef.current = candlestickSeries;
    chartRef.current = chart;

    const timeScale = chart.timeScale();

    // Format for non-hover state (just the day)
    (timeScale as any).applyOptions({
      tickMarkFormatter: (time: Time) => {
        const date = new Date(time as number * 1000);
        return date.getDate().toString();
      }
    });

    const fetchInitialData = async () => {
      try {
        // Clear existing data first
        candlestickSeriesRef.current.setData([]);

        const response = await axios.get(
          `https://api.exchange.coinbase.com/products/${symbol}/candles?granularity=${selectedInterval.granularity}`
        );
        const initialData = response.data.map((candle: any) => ({
          time: candle[0] as Time,
          open: Number(candle[3]),
          high: Number(candle[2]),
          low: Number(candle[1]),
          close: Number(candle[4]),
        }));

        initialData.sort((a: any, b: any) => (a.time as number) - (b.time as number));
        candlestickSeriesRef.current.setData(initialData);

        if (initialData.length > 0) {
          const lastCandle = initialData[initialData.length - 1];
          setCurrentMinuteData(lastCandle);
          minuteTrackingRef.current = {
            high: lastCandle.high,
            low: lastCandle.low,
            open: lastCandle.open,
            currentMinute: Math.floor((lastCandle.time as number) / selectedInterval.seconds)
          };
        }
      } catch (error) {
        console.error('Error fetching initial data:', error);
      }
    };

    fetchInitialData();

    const ws = new WebSocket('wss://ws-feed.exchange.coinbase.com');
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'subscribe',
        product_ids: [symbol],
        channels: ['ticker']
      }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'ticker') {
        const price = Number(data.price);
        const timestamp = Math.floor(Date.now() / 1000);
        // Calculate the start of the current interval
        const currentInterval = Math.floor(timestamp / selectedInterval.seconds) * selectedInterval.seconds;

        // Update dynamic data
        setLastPrice(price);
        // Assuming you can calculate or fetch the change percentage, volume, high, and low from WebSocket data or another API
        // This part would need to be adjusted based on actual data structure or additional API calls
        setLastPriceChangePercent(calculatePriceChangePercent(price)); // You need to define this function
        setVolume24h(data.volume_24h); // Example, adjust based on data structure
        setHigh24h(data.high_24h); // Example, adjust based on data structure
        setLow24h(data.low_24h); // Example, adjust based on data structure

        // New interval started
        if (currentInterval !== minuteTrackingRef.current.currentMinute) {
          // Finalize the previous candle with its actual interval start time
          if (currentMinuteData) {
            const finalizedCandle: PriceData = {
              time: minuteTrackingRef.current.currentMinute as Time, // Use the actual interval start time
              open: minuteTrackingRef.current.open,
              high: minuteTrackingRef.current.high,
              low: minuteTrackingRef.current.low,
              close: price // Last known price becomes the close
            };
            candlestickSeriesRef.current.update(finalizedCandle);
          }

          // Start new candle at the interval boundary
          minuteTrackingRef.current = {
            high: price,
            low: price,
            open: price, // First price of the new interval
            currentMinute: currentInterval // Store the interval start time
          };

          const newCandlestick: PriceData = {
            time: currentInterval as Time,
            open: price,
            high: price,
            low: price,
            close: price
          };
          setCurrentMinuteData(newCandlestick);
          candlestickSeriesRef.current.update(newCandlestick);
        } else {
          // Update existing candle
          const updatedCandlestick: PriceData = {
            time: currentInterval as Time,
            open: minuteTrackingRef.current.open, // Keep original open
            high: Math.max(minuteTrackingRef.current.high, price),
            low: Math.min(minuteTrackingRef.current.low, price),
            close: price // Current price is the latest close
          };

          minuteTrackingRef.current.high = updatedCandlestick.high;
          minuteTrackingRef.current.low = updatedCandlestick.low;

          setCurrentMinuteData(updatedCandlestick);
          candlestickSeriesRef.current.update(updatedCandlestick);
        }
      }
    };

    ws.onerror = (error) => console.log('WebSocket Error:', error);

      // Function to fetch 24h stats if not available from WebSocket
      const fetch24hStats = async () => {
        try {
          const response = await axios.get(`https://api.exchange.coinbase.com/products/${symbol}/stats`);
          setLastPrice(Number(response.data.last));
          setLastPriceChangePercent(calculatePriceChangePercent(Number(response.data.last)));
          setVolume24h(Number(response.data.volume));
          setHigh24h(Number(response.data.high));
          setLow24h(Number(response.data.low));
        } catch (error) {
          console.error('Error fetching 24h stats:', error);
        }
      };
  
      fetch24hStats();

    // Handle mouse hover to change time scale format
    let isHovering = false;
    const handleMouseEnter = () => {
      isHovering = true;
      (timeScale as any).applyOptions({
        tickMarkFormatter: (time: Time) => {
          const date = new Date(time as number * 1000);
          const day = date.getDate();
          const month = date.toLocaleString('default', { month: 'short' });
          const year = date.getFullYear().toString().slice(-2);
          const minutes = String(date.getMinutes()).padStart(2, '0');
          return `${date.getHours()}:${minutes}`;
        }
      });
    };

    const handleMouseLeave = () => {
      isHovering = false;
      (timeScale as any).applyOptions({
        tickMarkFormatter: (time: Time) => {
          const date = new Date(time as number * 1000);
          return date.getDate().toString();
        }
      });
    };

    chartContainerRef.current.addEventListener('mouseenter', handleMouseEnter);
    chartContainerRef.current.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (chartRef.current) {
        chartRef.current.remove();
      }
      candlestickSeriesRef.current = null;
      chartContainerRef.current?.removeEventListener('mouseenter', handleMouseEnter);
      chartContainerRef.current?.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [symbol, selectedInterval]);

  // Placeholder function for price change calculation
  const calculatePriceChangePercent = (currentPrice: number): number => {
    // This is a placeholder. You would need to implement the actual logic to calculate the percentage change
    // based on how you want to compute it, possibly fetching the previous price or using historical data
    return 5.38; // Example percentage, replace with real calculation
  };

  return (
    <div className="w-full font-sans my-2">
      <div className="flex flex-row mb-2">
        <div className="">
          <select
            value={selectedInterval.label}
            onChange={(e) => {
              const interval = INTERVALS.find(i => i.label === e.target.value);
              if (interval) setSelectedInterval(interval);
            }}
            className="bg-gray-700 text-white px-3 py-2 rounded-md"
          >
            {INTERVALS.map((interval) => (
              <option key={interval.label} value={interval.label}>
                {interval.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex justify-between gap-4 w-[700px] font-bold mx-4 text-sm">
          <div className="flex-auto text-left w-1/4">
            <div className="text-gray-400 text-xs">LAST PRICE (24H)</div>
            <div>{intl.format(lastPrice as number)} &nbsp;
              <span className={lastPriceChangePercent as number ? "text-[#24AC74]": "text-[#F0616D]"}>
              {lastPriceChangePercent as number > 0 ? '+': '-'}{lastPriceChangePercent}%
              </span>
            </div>
          </div>
          <div className="flex-auto text-left w-1/4">
            <div className="text-gray-400 text-xs">24H VOLUME</div>
            <div>{intl.format(volume24h as number * 100000)}</div>
          </div>
          <div className="flex-auto text-left w-1/4">
            <div className="text-gray-400 text-xs">24H HIGH</div>
            <div>{intl.format(high24h as number)} </div>
          </div>
          <div className="flex-auto text-left w-1/4">
            <div className="text-gray-400 text-xs">24H LOW</div>
            <div>{intl.format(low24h as number)}</div>
          </div>
        </div>
      </div>
      <div ref={chartContainerRef} className="w-3/4 h-[400px]" />
    </div>
  );
};

export default PriceChart;