import React from 'react';
import { createRoot } from 'react-dom/client';
import Participant from './Participant.jsx';
import Admin from './Admin.jsx';
import './styles.css';

const App = window.location.pathname.startsWith('/admin') ? Admin : Participant;
createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
