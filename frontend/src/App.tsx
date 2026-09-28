import { useState } from 'react';
import Catalogue from './components/Catalogue';
import MesInscriptions from './components/MesInscriptions';

// Pas d'authentification dans ce projet : on fixe un étudiant courant.
// /!\ Remplace par un ID réel présent dans le service Étudiants de A.
export const ETUDIANT_ID = '11111111-1111-1111-1111-111111111111';

export default function App() {
  const [onglet, setOnglet] = useState<'catalogue' | 'inscriptions'>('catalogue');

  return (
    <div className="app">
      <h1>Inscriptions aux cours</h1>

      <nav className="tabs">
        <button
          className={onglet === 'catalogue' ? 'active' : ''}
          onClick={() => setOnglet('catalogue')}
        >
          Catalogue
        </button>
        <button
          className={onglet === 'inscriptions' ? 'active' : ''}
          onClick={() => setOnglet('inscriptions')}
        >
          Mes inscriptions
        </button>
      </nav>

      {onglet === 'catalogue' ? <Catalogue /> : <MesInscriptions />}
    </div>
  );
}
