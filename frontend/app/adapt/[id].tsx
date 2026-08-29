import { useLocalSearchParams } from 'expo-router';
import { AdaptScreen } from '@/src/adapt/AdaptScreen';

export default function RecipeAdapt() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <AdaptScreen recipeId={id} />;
}
