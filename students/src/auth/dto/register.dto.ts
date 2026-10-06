import { IsEmail, IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';

/**
 * Inscription publique d'un ELEVE.
 * ATTENTION : pas de champ `role` ici — on ne doit JAMAIS laisser le client
 * choisir son rôle. Le role est forcé à ELEVE dans AuthService.register().
 */
export class RegisterDto {
  @IsNotEmpty({ message: 'Le nom est requis.' })
  @IsString()
  nom: string;

  @IsNotEmpty({ message: 'Le prénom est requis.' })
  @IsString()
  prenom: string;

  @IsEmail({}, { message: 'Email invalide.' })
  email: string;

  @IsNotEmpty({ message: 'Le téléphone est requis.' })
  @Matches(/^[0-9+\-.\s()]{6,20}$/, { message: 'Téléphone invalide (chiffres, +, -, ., espace).' })
  telephone: string;

  @IsNotEmpty({ message: 'Le mot de passe est requis.' })
  @MinLength(6, { message: 'Mot de passe trop court (min. 6 caractères).' })
  password: string;
}
