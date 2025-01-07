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
  { label: '30 minutes', seconds: 1800, granularity: 1800 },
  { label: '1 hour', seconds: 3600, granularity: 3600 },
  { label: '2 hours', seconds: 7200, granularity: 7200 },
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

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 400,
      layout: {
        background: {
          // type: ColorType.Solid, color: "#FFFFFF80"
        },
        // textColor: "#fff"
      }
    });
    const candlestickSeries = chart.addCandlestickSeries();
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

    ws.onerror = (error) => console.error('WebSocket Error:', error);

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
          return `${day} ${month} '${year} ${date.getHours()}:${minutes}`;
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

  return (
    <div className="w-full">
      <div className="mb-4">
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
      <div ref={chartContainerRef} className="w-full h-[400px]" />
    </div>
  );
};

export default PriceChart;