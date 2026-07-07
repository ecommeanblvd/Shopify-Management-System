import { describe, it, expect } from 'vitest';
import { classifyFFIT, voteBodyShape, deriveBodyShape } from './body-shape';

describe('classifyFFIT (measurements, inches)', () => {
  it('hourglass: bust≈hips, waist much smaller', () => {
    expect(classifyFFIT({ bust: 36, waist: 26, hips: 37 })).toBe('hourglass');
  });
  it('pear/triangle: hips > bust, waist not tiny', () => {
    expect(classifyFFIT({ bust: 36, waist: 32, hips: 40 })).toBe('pear');
  });
  it('invertedTriangle: bust > hips', () => {
    expect(classifyFFIT({ bust: 40, waist: 34, hips: 35 })).toBe('invertedTriangle');
  });
  it('rectangle: balanced, waist not defined', () => {
    expect(classifyFFIT({ bust: 36, waist: 30, hips: 37 })).toBe('rectangle');
  });
  it('apple: waist is the largest girth (eo dominant beats rectangle)', () => {
    expect(classifyFFIT({ bust: 36, waist: 38, hips: 37 })).toBe('apple');
  });
});

describe('voteBodyShape (no measurements)', () => {
  it('clear pear answers', () => {
    const r = voteBodyShape({ q1_gain: 'hips', q2_widest: 'hips', q4_shoulders: 'hips' });
    expect(r.shape).toBe('pear');
  });
  it('guard: waist wider forces apple even if other votes lean elsewhere', () => {
    const r = voteBodyShape({ q1_gain: 'hips', q3_waist: 'wider' });
    expect(r.shape).toBe('apple');
  });
  it('guard: sharp waist + balanced shoulders → hourglass', () => {
    const r = voteBodyShape({ q3_waist: 'sharp', q4_shoulders: 'balanced' });
    expect(r.shape).toBe('hourglass');
  });
  it('guard: slight waist + balanced → rectangle', () => {
    const r = voteBodyShape({ q3_waist: 'slight', q4_shoulders: 'balanced' });
    expect(r.shape).toBe('rectangle');
  });
});

describe('deriveBodyShape', () => {
  it('measurements OVERRIDE the vote', () => {
    // vote leans pear, nhưng số đo là inverted → inverted thắng
    const r = deriveBodyShape({ q1_gain: 'hips', q2_widest: 'hips', measurements: { bust: 40, waist: 34, hips: 35 } });
    expect(r.shape).toBe('invertedTriangle');
    expect(r.fromMeasurements).toBe(true);
    expect(r.confidence).toBe('refined');
  });
  it('applies height + proportion modifier orthogonally', () => {
    const r = deriveBodyShape({ q1_gain: 'hips', heightCm: 158, proportion: 'longTorsoShortLegs' });
    expect(r.heightBand).toBe('petite');
    expect(r.proportion).toBe('longTorsoShortLegs');
  });
  it('defaults height to regular / balanced when not given', () => {
    const r = deriveBodyShape({ q1_gain: 'bustHips' });
    expect(r.heightBand).toBe('regular');
    expect(r.proportion).toBe('balanced');
  });
});
