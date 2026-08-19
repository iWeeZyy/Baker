import { useLocalSearchParams } from 'expo-router';
import { CostScreen } from '@/src/cost/CostScreen';

export default function RecipeCost() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CostScreen recipeId={id} />;
}
