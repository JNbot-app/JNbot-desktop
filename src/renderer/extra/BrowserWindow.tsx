import '../styles.css';
import Router from './components/Routing';
import React from 'react';

const BrowserWindow: React.FC<{ routes: any[] }> = ({ routes }) => {
  return (
        <Router routes={routes} />
  );
};

export default BrowserWindow;
