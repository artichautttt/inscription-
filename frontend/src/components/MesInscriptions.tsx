import { useEffect, useState } from 'react';
import type { Inscription } from '../types';
import { getMyEnrollments } from '../api';
import { ETUDIANT_ID } from '../App';

export default function MesInscriptions() {
    const [items, setItems] = useState<Inscription[]>([]);
    const [chargement, setChargement] = useState(true);
    const [erreur, setErreur] = useState('');

    useEffect(() => {
        getMyEnrollments(ETUDIANT_ID)
            .then((data) => setItems(data))
            .catch((e) => setErreur(e.message))
            .finally(() => setChargement(false));
    }, []);

    if (chargement) return <p>Chargement…</p>;

    return (
        <div>
            <h2>Mes inscriptions</h2>
            {erreur && <p className="erreur">{erreur}</p>}

            {items.length === 0 && !erreur ? (
                <p>Aucune inscription pour le moment.</p>
            ) : (
                <ul className="liste">
                    {items.map((i) => (
                        <li key={i.id} className="carte">
                            <div>
                                <strong>Cours : {i.coursId}</strong>
                                <br />
                                <span>Le {new Date(i.date).toLocaleDateString('fr-FR')}</span>
                            </div>
                            <span>{i.statut}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}