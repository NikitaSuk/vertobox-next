"use client"

import React, { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickData, Time, ColorType, ITimeScaleApi } from 'lightweight-charts';
import axios from 'axios';
import { SegmentedControl } from '@blueprintjs/core';
import './PriceChart.css'

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

const ControlIntervals = [
  { label: "1M", value: "60" },
  { label: "5M", value: "300" },
  { label: "15M", value: "900" },
  { label: "1H", value: "3600" },
  { label: "6H", value: "21600" },
  { label: "1D", value: "86400" },
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
  const [open24h, setOpen24h] = useState<number | null>(null);
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
        const currentPrice = Number(data.price);
        setLastPrice(currentPrice);

        if (open24h) {
          const rawPercentChange = ((currentPrice - open24h) / open24h) * 100;
          const adjustedChange = rawPercentChange * 0.98;
          const percentChange = Math.floor(Math.abs(adjustedChange) * 100) / 100 * (adjustedChange < 0 ? -1 : 1);
          setLastPriceChangePercent(percentChange);
        }

        setVolume24h(data.volume_24h ? Number(data.volume_24h) : null);
        setHigh24h(data.high_24h ? Number(data.high_24h) : null);
        setLow24h(data.low_24h ? Number(data.low_24h) : null);
      }
    }


    ws.onerror = (error) => console.log('WebSocket Error:', error);

    const getOpenPrice = async () => {
      try {
        // Get the candle data for the last 24 hours
        const now = new Date();
        const start = new Date(now.getTime() - (24 * 60 * 60 * 1000));

        const response = await axios.get(
          `https://api.exchange.coinbase.com/products/${symbol}/candles`,
          {
            params: {
              start: start.toISOString(),
              end: now.toISOString(),
              granularity: 86400 // daily candles
            }
          }
        );

        // The first candle contains the open price we need
        if (response.data && response.data[0]) {
          return response.data[0][3]; // Opening price is at index 3
        }
        return null;
      } catch (error) {
        console.error('Error fetching open price:', error);
        return null;
      }
    };

    const fetch24hStats = async () => {
      try {
        const response = await axios.get(`https://api.exchange.coinbase.com/products/${symbol}/stats`);
        const currentPrice = Number(response.data.last);
        const openPrice = Number(response.data.open);

        setLastPrice(currentPrice);
        setOpen24h(openPrice);

        // Adjusted calculation with slight offset
        const rawPercentChange = ((currentPrice - openPrice) / openPrice) * 100;
        // Apply a small adjustment factor of 0.98 to slightly reduce the percentage
        const adjustedChange = rawPercentChange * 0.98;
        const percentChange = Math.floor(Math.abs(adjustedChange) * 100) / 100 * (adjustedChange < 0 ? -1 : 1);
        setLastPriceChangePercent(percentChange);

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
          // const day = date.getDate();
          // const month = date.toLocaleString('default', { month: 'short' });
          // const year = date.getFullYear().toString().slice(-2);
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

  return (
    <div className="w-full font-sans my-2">
      <div className="w-3/4 flex flex-row mb-2">
        
        {/* Market Data [start] */}
        <div className="flex justify-between gap-4 w-3/4 font-semibold mx-4 text-sm">
          <div className="flex-auto text-left w-1/6">
            <div className="text-gray-400 text-xs">LAST PRICE (24H)</div>
            <div>{intl.format(lastPrice as number)} &nbsp;
              <span className={lastPriceChangePercent && lastPriceChangePercent > 0 ? "text-[#24AC74]" : "text-[#F0616D]"}>
                {lastPriceChangePercent ? `${lastPriceChangePercent > 0 ? '+' : ''}${lastPriceChangePercent.toFixed(2)}%` : '0.00%'}
              </span>
            </div>
          </div>
          <div className="flex-auto text-left w-1/6">
            <div className="text-gray-400 text-xs">24H VOLUME</div>
            <div>{intl.format(volume24h as number * 100000)}</div>
          </div>
          <div className="flex-auto text-left w-1/8">
            <div className="text-gray-400 text-xs">24H HIGH</div>
            <div>{intl.format(high24h as number)} </div>
          </div>
          <div className="flex-auto text-left w-1/8">
            <div className="text-gray-400 text-xs">24H LOW</div>
            <div>{intl.format(low24h as number)}</div>
          </div>
        </div>
        {/* Market Data [end] */}

        {/* Interval Selection [start] */}
        <div className='w-1/4'>
          <SegmentedControl
            options={ControlIntervals}
            value={selectedInterval.granularity.toString()}
            defaultValue={ControlIntervals[0].value}
            onValueChange={(value: any) => {
              const interval = ControlIntervals.find(i => i.value === value);
              if (interval) {
                setSelectedInterval({
                  label: interval.label,
                  seconds: Number(interval.value),
                  granularity: Number(interval.value)
                });
              }
            }}
            className="segmented-control-custom"
          />
        </div>
        {/* Interval Selection [end] */}

      </div>
      <div ref={chartContainerRef} className="w-3/4 h-[400px]" />
    </div>
  );
};

export default PriceChart;